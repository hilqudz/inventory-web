# Fase 6 — Deploy ke VPS (panduan jalankan manual)

Jalankan bagian ini **berurutan**, dari VPS `inventoryrpg@103.59.94.43` (AlmaLinux).
Setiap bagian ada **checkpoint** — jangan lanjut ke bagian berikutnya sebelum checkpoint-nya lolos.

⚠️ **Urutan hardening SSH sengaja ditaruh paling akhir dari sub-langkah 1**, supaya kamu tidak terkunci
dari VPS kalau ada yang salah di tengah jalan. Ikuti urutan persis seperti di bawah, jangan dibalik.

---

## 1. Hardening VPS

### 1a. Setup SSH key-based login (WAJIB sebelum matikan password login)

Dari **Mac kamu** (bukan di VPS):

```bash
ssh-copy-id inventoryrpg@103.59.94.43
```

Kalau `ssh-copy-id` tidak ada, manual:
```bash
cat ~/.ssh/id_ed25519.pub | ssh inventoryrpg@103.59.94.43 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**Checkpoint 1a** — buka terminal baru (jangan tutup sesi yang sekarang), test login TANPA password:
```bash
ssh inventoryrpg@103.59.94.43 "echo SSH key login OK"
```
Kalau muncul "SSH key login OK" tanpa diminta password → lanjut. Kalau masih minta password → **STOP**, jangan lanjut ke 1b.

### 1b. Matikan password login SSH (baru boleh setelah checkpoint 1a lolos)

Di VPS:
```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-$(date +%Y%m%d)
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

**Checkpoint 1b** — dari terminal BARU (jangan pakai sesi yang sedang sudo tadi), test lagi:
```bash
ssh inventoryrpg@103.59.94.43 "echo masih bisa masuk"
```
Kalau gagal, kamu masih punya sesi SSH lama yang terbuka untuk rollback:
```bash
sudo cp /etc/ssh/sshd_config.bak-<tanggal> /etc/ssh/sshd_config && sudo systemctl restart sshd
```

### 1c. Firewall dasar + fail2ban

```bash
sudo dnf install -y firewalld fail2ban
sudo systemctl enable --now firewalld
sudo systemctl enable --now fail2ban

# Izinkan SSH dulu (port default 22) — WAJIB sebelum firewalld start beneran dipakai
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
```

**Checkpoint 1c**: `sudo firewall-cmd --list-all` harus menampilkan `services: ssh` — dan pastikan kamu masih bisa buka terminal SSH baru sebelum lanjut.

---

## 2. Build & copy `dist/`

Dari **Mac kamu**, di folder project:
```bash
npm run build
```

Ini hasilkan `dist/index.html`, `dist/assets/*`, dan `dist/server.cjs`.

Copy ke VPS (bikin folder dulu):
```bash
ssh inventoryrpg@103.59.94.43 "mkdir -p /var/www/rpg-inventory-app"
scp -r dist package.json package-lock.json inventoryrpg@103.59.94.43:/var/www/rpg-inventory-app/
```

Di VPS, install dependency production saja (server.cjs sudah bundled, tapi native module seperti `bcrypt` perlu di-rebuild untuk platform VPS):
```bash
cd /var/www/rpg-inventory-app
npm ci --omit=dev
```

### Buat `.env` di VPS (BUKAN di-copy dari Mac — isi beda)

```bash
nano /var/www/rpg-inventory-app/.env
```

Isi (catatan penting di bawah):
```env
DB_HOST="localhost"
DB_PORT=1433
DB_NAME="InventoryGudang"
DB_USER="app_inventory_user"
DB_PASSWORD="<password_asli>"
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true
JWT_SECRET="<random_string_panjang_BEDA_dari_dev>"
GEMINI_API_KEY="<api_key_gemini>"
UPLOAD_DIR="/var/www/uploads/foto-barang"
PORT=3000
NODE_ENV=production
```

**Penting:**
- `DB_HOST="localhost"` — di VPS, API dan SQL Server ada di mesin yang sama, jadi **bukan** lewat SSH tunnel lagi (tunnel cuma dipakai pas dev di Mac). Pastikan container SQL Server bind ke `127.0.0.1:1433` (bukan `0.0.0.0`) sesuai CLAUDE.md.
- `DB_USER` sebaiknya `app_inventory_user` (bukan `sa`) sesuai keputusan Fase 1 — cek dulu apakah user ini sudah dibuat di SQL Server; kalau belum, buat dulu sebelum lanjut.
- `JWT_SECRET` **harus beda** dari yang dipakai waktu dev — kalau sama, token dev bisa dipakai login ke production.
- `UPLOAD_DIR` diarahkan ke `/var/www/uploads/foto-barang` (path absolut, di luar folder app) sesuai CLAUDE.md, bukan folder relatif seperti pas dev.

Buat folder upload:
```bash
sudo mkdir -p /var/www/uploads/foto-barang
sudo chown -R inventoryrpg:inventoryrpg /var/www/uploads
```

**Checkpoint 2**: `chmod 600 /var/www/rpg-inventory-app/.env` (biar tidak bisa dibaca user lain), lalu:
```bash
ls -la /var/www/rpg-inventory-app/dist/server.cjs /var/www/rpg-inventory-app/.env
```
Kedua file harus ada.

---

## 3. PM2 — jalankan API sebagai service permanen

```bash
sudo npm install -g pm2
cd /var/www/rpg-inventory-app
pm2 start dist/server.cjs --name rpg-inventory --env production
pm2 save
pm2 startup systemd -u inventoryrpg --hp /home/inventoryrpg
```

Command terakhir akan mencetak satu baris `sudo env PATH=... pm2 startup ...` — **copy-paste dan jalankan baris itu juga** (PM2 tidak bisa auto-run command bersyarat).

**Checkpoint 3**:
```bash
pm2 status
curl -s http://localhost:3000/api/health
```
Harus muncul `{"status":"ok",...}`. Kalau error, cek log: `pm2 logs rpg-inventory --lines 50`.

---

## 4. Nginx — reverse proxy + serve static

```bash
sudo dnf install -y nginx
```

Buat config baru:
```bash
sudo nano /etc/nginx/conf.d/rpg-inventory.conf
```

Isi:
```nginx
server {
    listen 80;
    server_name _;   # ganti ke domain kamu nanti setelah DNS siap, mis: inventory.rpg.co.id

    root /var/www/rpg-inventory-app/dist;
    index index.html;

    client_max_body_size 15m;   # sesuai limit express.json({limit:"15mb"}) di server.ts

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        alias /var/www/uploads/;
        autoindex off;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo nginx -t
sudo systemctl enable --now nginx
```

**Checkpoint 4**: dari VPS sendiri dulu:
```bash
curl -s http://localhost/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/
```
Keduanya harus sukses (200) sebelum buka ke publik.

---

## 5. Firewall final — cuma 80/443 publik

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

Port 1433 dan 3000 **tidak perlu** ditambahkan ke firewall — defaultnya firewalld sudah menutup semua port yang tidak di-`--add-service`/`--add-port`. Verifikasi:
```bash
sudo firewall-cmd --list-ports
sudo firewall-cmd --list-services
```
Harus cuma `ssh http https` — tidak ada `1433` atau `3000`.

---

## 6. SSL (Let's Encrypt) — **butuh domain dulu**

Ini butuh domain yang sudah di-pointing ke IP VPS (belum dibahas — lihat catatan CLAUDE.md soal domain di Fase 6 asli). Kalau domain sudah siap:

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d inventory.rpg.co.id   # ganti sesuai domain asli
```

Certbot otomatis edit config Nginx untuk redirect HTTP→HTTPS dan setup auto-renewal.

**Checkpoint 6**: `curl -sI https://<domain>/api/health` harus 200 dengan certificate valid (tidak warning SSL).

---

## 7. Test dari luar jaringan

Dari **HP pakai data seluler (bukan WiFi kantor/rumah yang sama dengan VPS)**:
- Buka `http://<ip-vps>/` atau `https://<domain>/` di browser HP.
- Coba login dengan akun yang sudah ada.
- Pastikan **BUKAN** bisa akses `http://<ip-vps>:3000` atau `<ip-vps>:1433` langsung dari luar (harus gagal connect / timeout).

```bash
# dari device lain, port 3000 dan 1433 harus TIDAK terbuka:
nc -zv -w3 103.59.94.43 3000    # harus "Connection refused" atau timeout
nc -zv -w3 103.59.94.43 1433    # harus "Connection refused" atau timeout
nc -zv -w3 103.59.94.43 80      # harus "succeeded"
```

---

## Checklist ringkas

- [ ] 1a-1c: SSH key-only login + firewall + fail2ban aktif, **checkpoint tiap sub-langkah lolos**
- [ ] 2: `dist/` + `.env` production ter-deploy, `DB_HOST=localhost`, `JWT_SECRET` beda dari dev
- [ ] 3: PM2 jalan, auto-restart terpasang, `pm2 status` sehat
- [ ] 4: Nginx reverse proxy jalan, `/api/health` via port 80 sukses
- [ ] 5: Firewall final — cuma ssh/http/https, port 1433 & 3000 tertutup dari luar
- [ ] 6: SSL terpasang (kalau domain sudah siap)
- [ ] 7: Diuji dari device eksternal (data seluler), port 1433/3000 terbukti tidak bisa diakses dari luar
