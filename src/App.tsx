import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  auth,
  db,
  COLLECTIONS,
  autoReconcileDoOpen,
  clearAllDatabaseDataPermanent,
  handleFirestoreError,
  OperationType,
  isFirestoreQuotaExceeded,
  setApiToken
} from './api';
// Firestore mati permanen (isFirestoreQuotaExceeded=true di api.ts) — stub
// ini menjaga blok legacy `if (!isFirestoreQuotaExceeded)` tetap compile
const collection = (..._args: any[]): any => null;
const query = (..._args: any[]): any => null;
const getDocs = async (..._args: any[]): Promise<any> => ({ docs: [], empty: true });
import { 
  MasterItem, 
  TransactionRecord, 
  DoOpenRecord, 
  RequestDoRecord,
  ContainerRecord,
  ActiveTab, 
  UserProfile,
  AppUser,
  getDoOpenLogistikGroup,
  ItemCatalogPhoto
} from './types';
import { 
  saveLocalCache, 
  loadLocalCache, 
  loadCatalogPhotosIndexedDB,
  clearCatalogPhotosIndexedDB,
  clearAllLocalCache 
} from './utils/localCache';
import { 
  deduplicateMasterItems, 
  deduplicateTransactions, 
  deduplicateDoOpen, 
  deduplicateRequestDoOpen 
} from './utils/deduplicate';
import { INITIAL_MASTER_ITEMS } from './data/initialMasterItems';
import {
  fetchMasterItems,
  fetchTransaksiMasuk,
  fetchTransaksiKeluar,
  fetchDoOpen,
  fetchRequestDoOpen,
  fetchUsersSupabase,
  fetchContainerStatus,
  clearSupabaseTable,
  fetchCatalogPhotosSupabase,
  upsertCatalogPhotoSupabase,
  bulkUpsertCatalogPhotosSupabase,
  deleteCatalogPhotoSupabase,
  bulkAddMasterItems,
  bulkAddTransaksiMasuk,
  bulkAddTransaksiKeluar
} from './api';

// Views
import { LoginView } from './views/LoginView';
import { NavbarHeader } from './components/NavbarHeader';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './views/DashboardView';
import { MasterItemView } from './views/MasterItemView';
import { TransaksiMasukView } from './views/TransaksiMasukView';
import { TransaksiKeluarView } from './views/TransaksiKeluarView';
import { SisaStockView } from './views/SisaStockView';
import { DoOpenView } from './views/DoOpenView';
import { RequestDoOpenView } from './views/RequestDoOpenView';
import { ReportRequestDoOpenView } from './views/ReportRequestDoOpenView';
import { RekonsiliasiStockView } from './views/RekonsiliasiStockView';
import { UserManagementView } from './views/UserManagementView';
import { SecurityMonitoringView } from './views/SecurityMonitoringView';
import ContainerStatusView from './views/ContainerStatusView';
import CifBapContainerView from './views/CifBapContainerView';
import { CatalogPhotoView } from './views/CatalogPhotoView';
import { AIChatBot } from './components/AIChatBot';

// Modals
import { ImportModal } from './components/ImportModal';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  // Lazy-init langsung ke tab yang benar untuk role OPR (bukan mulai dari
  // 'dashboard' lalu di-redirect via useEffect) — supaya sesi yang dipulihkan
  // dari localStorage (buka tab baru saat sudah login) tidak sempat memicu
  // pergantian tab dashboard->do_open yang bisa macet di animasi fade-in kalau
  // tab browser sedang tidak aktif/visible (lihat handleLoginSuccess untuk
  // kasus login baru pertama kali).
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    try {
      const saved = localStorage.getItem('gudang_active_user');
      const role = saved ? JSON.parse(saved)?.role : undefined;
      if (role === 'OPR' || role === 'Team Gudang') return 'do_open';
    } catch { /* localStorage rusak/diblokir — pakai default */ }
    return 'dashboard';
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Real-time Firestore Collections State (With Local Cache Fallback & Automatic Deduplication)
  const [masterItems, setMasterItems] = useState<MasterItem[]>(() => deduplicateMasterItems([...INITIAL_MASTER_ITEMS, ...(loadLocalCache(COLLECTIONS.MASTER_ITEMS) as MasterItem[])]));
  const [transaksiMasuk, setTransaksiMasuk] = useState<TransactionRecord[]>(() => deduplicateTransactions(loadLocalCache(COLLECTIONS.TRANSAKSI_MASUK)));
  const [transaksiKeluar, setTransaksiKeluar] = useState<TransactionRecord[]>(() => deduplicateTransactions(loadLocalCache(COLLECTIONS.TRANSAKSI_KELUAR)));
  const [doOpen, setDoOpen] = useState<DoOpenRecord[]>(() => deduplicateDoOpen(loadLocalCache(COLLECTIONS.DO_OPEN)));
  const [requestDoOpenRecords, setRequestDoOpenRecords] = useState<RequestDoRecord[]>(() => deduplicateRequestDoOpen(loadLocalCache(COLLECTIONS.REQUEST_DO_OPEN)));
  const [catalogPhotos, setCatalogPhotos] = useState<ItemCatalogPhoto[]>(() => loadLocalCache('katalog_foto'));
  const [containers, setContainers] = useState<ContainerRecord[]>(() => loadLocalCache('container_status'));
  const [usersList, setUsersList] = useState<AppUser[]>([]);
  const [isSyncingSupabase, setIsSyncingSupabase] = useState(false);

  // Fetch and Merge Users from Local Cache, Firestore & Supabase
  const fetchAndMergeUsers = async () => {
    try {
      // Cache lokal 'users_list' TIDAK terpisah per-akun (dipakai bareng semua
      // user di browser yang sama) — untuk role Audit ini berbahaya: di
      // komputer yang pernah dipakai Admin, cache lama berisi SEMUA user bisa
      // "bocor" ke sesi Audit meski server sudah membatasi respons ke pending
      // saja. Audit HANYA boleh percaya hasil server (sudah dibatasi di
      // userRoutes.ts), jangan digabung dengan cache lokal.
      const localUsers = user?.role === 'Audit' ? [] : loadLocalCache<AppUser>('users_list');

      let fsUsers: AppUser[] = [];
      if (!isFirestoreQuotaExceeded) {
        try {
          const qSnap = await getDocs(collection(db, COLLECTIONS.USERS));
          fsUsers = qSnap.docs.map(d => ({
            id: d.id,
            nik: d.data().nik,
            displayName: d.data().displayName || d.data().nik,
            password: d.data().password,
            role: d.data().role || 'Team Gudang',
            isApproved: d.data().isApproved !== undefined ? Boolean(d.data().isApproved) : false,
            createdAt: d.data().createdAt
          }));
        } catch (err) {
          console.warn('Firestore fetch users notice:', err);
        }
      }

      let sbUsers: AppUser[] = [];
      try {
        sbUsers = (await fetchUsersSupabase()) || [];
      } catch (err) {
        console.warn('Supabase fetch users notice:', err);
      }

      const userMap = new Map<string, AppUser>();

      // 1. Put Local Cache Users
      localUsers.forEach(u => {
        if (u.nik) {
          userMap.set(u.nik.trim().toLowerCase(), u);
        }
      });

      // 2. Put Supabase users (overrides if latest)
      sbUsers.forEach(u => {
        if (u.nik) {
          userMap.set(u.nik.trim().toLowerCase(), u);
        }
      });

      // 3. Firestore users (overrides/merges)
      fsUsers.forEach(u => {
        if (u.nik) {
          userMap.set(u.nik.trim().toLowerCase(), u);
        }
      });

      const mergedUsers = Array.from(userMap.values());
      setUsersList(mergedUsers);
      saveLocalCache('users_list', mergedUsers, true);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  // Sync all data from Supabase to Web UI
  const syncAllDataFromSupabase = async (showToastNotification: boolean = false) => {
    setIsSyncingSupabase(true);
    try {
      const results = await Promise.allSettled([
        fetchMasterItems(),
        fetchTransaksiMasuk(),
        fetchTransaksiKeluar(),
        fetchDoOpen(),
        fetchRequestDoOpen(),
        fetchUsersSupabase(),
        fetchContainerStatus(),
        fetchCatalogPhotosSupabase()
      ]);

      const mItems = results[0].status === 'fulfilled' ? results[0].value : null;
      const tMasuk = results[1].status === 'fulfilled' ? results[1].value : null;
      const tKeluar = results[2].status === 'fulfilled' ? results[2].value : null;
      const doO = results[3].status === 'fulfilled' ? results[3].value : null;
      const reqDo = results[4].status === 'fulfilled' ? results[4].value : null;
      const users = results[5].status === 'fulfilled' ? results[5].value : null;
      const containerData = results[6].status === 'fulfilled' ? results[6].value : null;
      const catPhotos = results[7].status === 'fulfilled' ? results[7].value : null;

      let loadedCounts = [];

      if (catPhotos !== null && catPhotos !== undefined) {
        // Supabase is source of truth during sync
        setCatalogPhotos(catPhotos);
        saveLocalCache('katalog_foto', catPhotos, true);
        if (catPhotos.length > 0) {
          loadedCounts.push(`${catPhotos.length} Foto`);
        } else {
          clearCatalogPhotosIndexedDB();
        }
      }

      if (mItems !== null && mItems !== undefined) {
        const cleanMItems = deduplicateMasterItems(mItems);
        setMasterItems(cleanMItems);
        saveLocalCache(COLLECTIONS.MASTER_ITEMS, cleanMItems, true);
        if (cleanMItems.length > 0) loadedCounts.push(`${cleanMItems.length} Master Item`);
      }
      if (tMasuk !== null && tMasuk !== undefined) {
        const cleanTMasuk = deduplicateTransactions(tMasuk);
        setTransaksiMasuk(cleanTMasuk);
        saveLocalCache(COLLECTIONS.TRANSAKSI_MASUK, cleanTMasuk, true);
        if (cleanTMasuk.length > 0) loadedCounts.push(`${cleanTMasuk.length} Masuk`);
      }
      if (tKeluar !== null && tKeluar !== undefined) {
        const cleanTKeluar = deduplicateTransactions(tKeluar);
        setTransaksiKeluar(cleanTKeluar);
        saveLocalCache(COLLECTIONS.TRANSAKSI_KELUAR, cleanTKeluar, true);
        if (cleanTKeluar.length > 0) loadedCounts.push(`${cleanTKeluar.length} Keluar`);
      }
      if (doO !== null && doO !== undefined) {
        const cleanDoO = deduplicateDoOpen(doO);
        setDoOpen(cleanDoO);
        saveLocalCache(COLLECTIONS.DO_OPEN, cleanDoO, true);
        if (cleanDoO.length > 0) loadedCounts.push(`${cleanDoO.length} DO OPEN`);
      }
      if (reqDo !== null && reqDo !== undefined) {
        const cleanReqDo = deduplicateRequestDoOpen(reqDo);
        setRequestDoOpenRecords(cleanReqDo);
        saveLocalCache(COLLECTIONS.REQUEST_DO_OPEN, cleanReqDo, true);
      }
      if (containerData !== null && containerData !== undefined) {
        setContainers(containerData);
        saveLocalCache('container_status', containerData, true);
        if (containerData.length > 0) loadedCounts.push(`${containerData.length} Container`);
      }
      
      // Merge users list
      await fetchAndMergeUsers();

      if (showToastNotification) {
        showToast(
          `Data Berhasil Dimuat Ulang! (${loadedCounts.join(', ') || '0 Data (Tabel Kosong)'})`,
          'success'
        );
      }
    } catch (err: any) {
      console.error('Error syncing data from SQL Server:', err);
      if (showToastNotification) {
        showToast(`Gagal memuat ulang data: ${err.message || 'Error'}`, 'error');
      }
    } finally {
      setIsSyncingSupabase(false);
    }
  };

  // Load initial IndexedDB catalog photos on mount
  useEffect(() => {
    loadCatalogPhotosIndexedDB().then(idbPhotos => {
      if (idbPhotos && idbPhotos.length > 0) {
        setCatalogPhotos(prev => {
          const photoMap = new Map<string, ItemCatalogPhoto>();
          const addPhotoToMap = (p: ItemCatalogPhoto) => {
            if (!p || !p.photoUrl) return;
            const key = p.id || `${(p.itemCode || 'NO_CODE').trim().toUpperCase()}___${(p.photoUrl || '').trim().slice(-80)}`;
            photoMap.set(key, p);
          };
          prev.forEach(addPhotoToMap);
          idbPhotos.forEach(addPhotoToMap);
          return Array.from(photoMap.values());
        });
      }
    });
  }, []);

  // Initial Sync from Supabase on Login/Startup
  useEffect(() => {
    if (user) {
      syncAllDataFromSupabase(false);
    }
  }, [user]);

  // Role Tab Enforcement (OPR, Team Gudang & BOD)
  useEffect(() => {
    if (user) {
      if (user.role === 'OPR') {
        setActiveTab('do_open');
      } else if (user.role === 'Team Gudang') {
        // Permintaan Pak Irvan 2026-08-18: Team Gudang cuma boleh di DO OPEN,
        // Request DO OPEN, dan Report DO OPEN Kirim.
        if (!['do_open', 'request_do_open', 'report_request_do'].includes(activeTab)) {
          setActiveTab('do_open');
        }
      } else if (user.role === 'BOD') {
        if (activeTab !== 'dashboard' && activeTab !== 'katalog_foto' && activeTab !== 'chat_bot') {
          setActiveTab('dashboard');
        }
      }
    }
  }, [user]);

  // Ref to hold current doOpen records without triggering listener re-subscriptions (Saves Firestore Reads!)
  const doOpenRef = useRef<DoOpenRecord[]>([]);
  useEffect(() => {
    doOpenRef.current = doOpen;
  }, [doOpen]);

  // Catalog Photo Handlers
  const handleSaveCatalogPhoto = async (photo: ItemCatalogPhoto): Promise<boolean> => {
    const photoId = photo.id || `photo_${photo.itemCode}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const photoWithId = { ...photo, id: photoId };
    const next = catalogPhotos.filter(p => p.id !== photoWithId.id);
    const updated = [photoWithId, ...next];
    setCatalogPhotos(updated);
    saveLocalCache('katalog_foto', updated, true);
    await upsertCatalogPhotoSupabase(photoWithId);
    return true;
  };

  const handleBulkSaveCatalogPhotos = async (photos: ItemCatalogPhoto[]): Promise<boolean> => {
    if (!photos.length) return true;
    const newMap = new Map<string, ItemCatalogPhoto>();
    catalogPhotos.forEach(p => {
      const key = p.id || `${p.itemCode}_${p.photoUrl?.substring(0, 30) || 'img'}`;
      newMap.set(key, p);
    });
    const preparedPhotos = photos.map((p, idx) => {
      const photoId = p.id || `photo_${p.itemCode || 'item'}_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
      return { ...p, id: photoId };
    });
    preparedPhotos.forEach(p => {
      newMap.set(p.id, p);
    });
    const updated = Array.from(newMap.values());
    setCatalogPhotos(updated);
    saveLocalCache('katalog_foto', updated, true);
    await bulkUpsertCatalogPhotosSupabase(preparedPhotos);
    return true;
  };

  const handleDeleteCatalogPhoto = async (id: string): Promise<boolean> => {
    if (user?.role && user.role !== 'Audit') {
      showToast(`Role ${user.role} tidak memiliki akses untuk menghapus foto katalog.`, 'error');
      return false;
    }
    const updated = catalogPhotos.filter(p => p.id !== id);
    setCatalogPhotos(updated);
    saveLocalCache('katalog_foto', updated, true);
    await deleteCatalogPhotoSupabase(id);
    return true;
  };

  // Toast / Banner Notifications State
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Import Modal State
  const [importModalConfig, setImportModalConfig] = useState<{
    isOpen: boolean;
    type: 'master' | 'transaksi_masuk' | 'transaksi_keluar' | 'do_open';
    collectionName: string;
  }>({
    isOpen: false,
    type: 'master',
    collectionName: COLLECTIONS.MASTER_ITEMS
  });

  // Delete Confirm Modal State
  const [deleteModalConfig, setDeleteModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    isBulkAll?: boolean;
    count?: number;
    loading?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: async () => {},
    isBulkAll: false
  });

  const [isReconciling, setIsReconciling] = useState(false);

  // Show Toast Helper
  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 5000);
  };

  // User Session Persistence — sesi dari localStorage; validitas sebenarnya
  // ditentukan token JWT API (Firebase Auth sudah tidak dipakai)
  useEffect(() => {
    const savedUser = localStorage.getItem('gudang_active_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        setUser(null);
      }
    } else {
      setUser(null);
    }
    setAuthChecking(false);
  }, []);

  // Handle Login Success
  const handleLoginSuccess = (userProfile: UserProfile) => {
    setUser(userProfile);
    // Set tab yang benar di render yang SAMA dengan setUser (bukan lewat efek
    // terpisah setelahnya) — supaya untuk role OPR/Team Gudang tidak ada render
    // transisi dashboard->do_open yang bisa memicu macetnya animasi fade-in
    // kalau tab browser kebetulan tidak sedang visible pas login pertama kali.
    if (userProfile.role === 'OPR' || userProfile.role === 'Team Gudang') {
      setActiveTab('do_open');
    }
    try {
      localStorage.setItem('gudang_active_user', JSON.stringify(userProfile));
    } catch (e) {
      console.warn('Gagal menyimpan sesi user:', e);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    setApiToken(null);
    localStorage.removeItem('gudang_active_user');
    setUser(null);
  };

  const handleClearAllDataPermanent = async () => {
    handleRequestDeleteConfirm(
      'Hapus Permanent Seluruh Data Database',
      'Apakah Anda benar-benar yakin ingin MENGHAPUS PERMANENT seluruh data (Master Item, Transaksi Masuk, Transaksi Keluar, DO OPEN, dan Request DO OPEN) dari database SQL Server? Tindakan ini tidak dapat dibatalkan.',
      async () => {
        try {
          await clearSupabaseTable('master_item');
          await clearSupabaseTable('transaksi_masuk');
          await clearSupabaseTable('transaksi_keluar');
          await clearSupabaseTable('do_open');
          await clearSupabaseTable('request_do_open');
        } catch (e) {
          console.warn('Gagal menghapus tabel:', e);
        }
        clearAllLocalCache();
        setMasterItems([]);
        setTransaksiMasuk([]);
        setTransaksiKeluar([]);
        setDoOpen([]);
        setRequestDoOpenRecords([]);
        showToast('Seluruh data di database SQL Server & cache browser telah berhasil dihapus secara permanent!', 'success');
      },
      true
    );
  };

  // Trigger Manual Auto-Reconcile DO OPEN (Zero extra reads using in-memory state)
  const handleRunAutoReconcile = async () => {
    setIsReconciling(true);
    try {
      const res = await autoReconcileDoOpen(doOpen, transaksiKeluar);
      if (res.deletedCount > 0) {
        const deletedDocSet = new Set(res.deletedDocs.map(d => d.trim().toUpperCase()));
        const remainingDoOpen = doOpen.filter(d => !deletedDocSet.has((d.documentNo || '').trim().toUpperCase()));
        
        setDoOpen(remainingDoOpen);
        saveLocalCache(COLLECTIONS.DO_OPEN, remainingDoOpen, true);

        showToast(`Rekonsiliasi Berhasil! ${res.deletedCount} DO OPEN (${res.deletedDocs.join(', ')}) otomatis terhapus dari database karena sudah ada di Transaksi Keluar.`, 'success');
      } else {
        showToast('Rekonsiliasi Selesai: Seluruh data DO OPEN sudah valid dan tidak ada No DO yang bentrok.', 'info');
      }
      return res;
    } catch (err: any) {
      console.error(err);
      showToast(`Gagal rekonsiliasi: ${err.message || 'Error'}`, 'error');
      return { deletedCount: 0, deletedDocs: [], deletedIds: [] };
    } finally {
      setIsReconciling(false);
    }
  };

  // Muat ulang & gabungkan Transaksi Masuk/Keluar dari Local Cache + SQL Server,
  // lalu tulis balik baris yang ada di cache tapi belum ada di database
  const handleRestoreStockFromCacheOrFirebase = async () => {
    setIsSyncingSupabase(true);
    try {
      showToast('Memulai pemulihan data Sisa Stock Qty...', 'info');

      // 1. Fetch from Firestore if available
      let fsMasuk: TransactionRecord[] = [];
      let fsKeluar: TransactionRecord[] = [];
      let fsMaster: MasterItem[] = [];

      if (!isFirestoreQuotaExceeded) {
        try {
          const snapMasuk = await getDocs(collection(db, COLLECTIONS.TRANSAKSI_MASUK));
          fsMasuk = snapMasuk.docs.map(d => ({ id: d.id, ...d.data() } as TransactionRecord));
        } catch (e) { console.warn('FS Masuk notice:', e); }

        try {
          const snapKeluar = await getDocs(collection(db, COLLECTIONS.TRANSAKSI_KELUAR));
          fsKeluar = snapKeluar.docs.map(d => ({ id: d.id, ...d.data() } as TransactionRecord));
        } catch (e) { console.warn('FS Keluar notice:', e); }

        try {
          const snapMaster = await getDocs(collection(db, COLLECTIONS.MASTER_ITEMS));
          fsMaster = snapMaster.docs.map(d => ({ id: d.id, ...d.data() } as MasterItem));
        } catch (e) { console.warn('FS Master notice:', e); }
      }

      // 2. Load from LocalCache
      const cacheMasuk = loadLocalCache<TransactionRecord>(COLLECTIONS.TRANSAKSI_MASUK);
      const cacheKeluar = loadLocalCache<TransactionRecord>(COLLECTIONS.TRANSAKSI_KELUAR);
      const cacheMaster = loadLocalCache<MasterItem>(COLLECTIONS.MASTER_ITEMS);

      // 3. Load from Supabase
      const sbMasuk = (await fetchTransaksiMasuk()) || [];
      const sbKeluar = (await fetchTransaksiKeluar()) || [];
      const sbMaster = (await fetchMasterItems()) || [];
      const sbDoOpen = (await fetchDoOpen()) || [];
      const sbPhotos = (await fetchCatalogPhotosSupabase()) || [];

      // Merge and deduplicate
      const combinedMasuk = deduplicateTransactions([...cacheMasuk, ...fsMasuk, ...sbMasuk, ...transaksiMasuk]);
      const combinedKeluar = deduplicateTransactions([...cacheKeluar, ...fsKeluar, ...sbKeluar, ...transaksiKeluar]);
      const combinedMaster = deduplicateMasterItems([...cacheMaster, ...fsMaster, ...sbMaster, ...masterItems]);
      const cacheDoOpen = loadLocalCache<DoOpenRecord>(COLLECTIONS.DO_OPEN);
      const combinedDoOpen = deduplicateDoOpen([...cacheDoOpen, ...sbDoOpen, ...doOpen]);

      // Combine catalog photos from state, IndexedDB, local cache, Firestore, and Supabase
      let fsPhotos: ItemCatalogPhoto[] = [];
      if (!isFirestoreQuotaExceeded) {
        try {
          const snapPhotos = await getDocs(collection(db, COLLECTIONS.KATALOG_FOTO));
          fsPhotos = snapPhotos.docs.map(d => ({ id: d.id, ...d.data() } as ItemCatalogPhoto));
        } catch (e) { console.warn('FS Photos notice:', e); }
      }

      const localCachedPhotos = loadLocalCache('katalog_foto') || [];
      const idbPhotos = await loadCatalogPhotosIndexedDB();
      const photoMap = new Map<string, ItemCatalogPhoto>();

      const addPhotoToMap = (p: ItemCatalogPhoto) => {
        if (!p || !p.photoUrl) return;
        const key = p.id || `${(p.itemCode || 'NO_CODE').trim().toUpperCase()}___${(p.photoUrl || '').trim().slice(-80)}`;
        photoMap.set(key, p);
      };

      (catalogPhotos || []).forEach(addPhotoToMap);
      localCachedPhotos.forEach(addPhotoToMap);
      idbPhotos.forEach(addPhotoToMap);
      fsPhotos.forEach(addPhotoToMap);
      (sbPhotos || []).forEach(addPhotoToMap);

      const mergedPhotos = Array.from(photoMap.values());
      setCatalogPhotos(mergedPhotos);
      if (mergedPhotos.length > 0) {
        saveLocalCache('katalog_foto', mergedPhotos, true);
        await bulkUpsertCatalogPhotosSupabase(mergedPhotos);
      }

      setMasterItems(combinedMaster);
      setTransaksiMasuk(combinedMasuk);
      setTransaksiKeluar(combinedKeluar);
      setDoOpen(combinedDoOpen);

      saveLocalCache(COLLECTIONS.MASTER_ITEMS, combinedMaster, true);
      saveLocalCache(COLLECTIONS.TRANSAKSI_MASUK, combinedMasuk, true);
      saveLocalCache(COLLECTIONS.TRANSAKSI_KELUAR, combinedKeluar, true);
      saveLocalCache(COLLECTIONS.DO_OPEN, combinedDoOpen, true);

      // 4. Tulis balik ke SQL Server baris yang ada di cache lokal / gabungan
      // tapi belum ada di database (mis. sempat gagal tersimpan). "existing"
      // diambil dari sbMasuk/sbKeluar/sbMaster (hasil fetch nyata di langkah 3),
      // bukan query terpisah — supaya tidak ada baris yang ke-double-insert.
      const buildTransaksiSig = (r: { documentNo?: string; itemCode?: string; postingDate?: string; qty?: number; fromLocation?: string; toLocation?: string }) =>
        `${(r.documentNo || '').trim().toUpperCase()}_${(r.itemCode || '').trim().toUpperCase()}_${(r.postingDate || '').slice(0, 10)}_${r.qty}_${(r.fromLocation || '').trim().toUpperCase()}_${(r.toLocation || '').trim().toUpperCase()}`;

      let restoredMasukCount = 0;
      let restoredKeluarCount = 0;

      if (combinedMaster.length > 0) {
        await bulkAddMasterItems(combinedMaster);
      }

      if (combinedMasuk.length > 0) {
        const existingSet = new Set(sbMasuk.map(buildTransaksiSig));
        const newMasuk = combinedMasuk.filter(r => r.itemCode && !existingSet.has(buildTransaksiSig(r)));
        if (newMasuk.length > 0) {
          await bulkAddTransaksiMasuk(newMasuk);
          restoredMasukCount = newMasuk.length;
        }
      }

      if (combinedKeluar.length > 0) {
        const existingSet = new Set(sbKeluar.map(buildTransaksiSig));
        const newKeluar = combinedKeluar.filter(r => r.itemCode && !existingSet.has(buildTransaksiSig(r)));
        if (newKeluar.length > 0) {
          await bulkAddTransaksiKeluar(newKeluar);
          restoredKeluarCount = newKeluar.length;
        }
      }

      showToast(`Pemulihan Selesai! ${restoredMasukCount} Transaksi Masuk & ${restoredKeluarCount} Transaksi Keluar yang belum tersimpan berhasil ditulis ke database SQL Server. Tampilan sudah dimuat ulang (${combinedMasuk.length} Masuk, ${combinedKeluar.length} Keluar, ${mergedPhotos.length} Foto Katalog).`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast(`Gagal memulihkan data: ${err.message || 'Error'}`, 'error');
    } finally {
      setIsSyncingSupabase(false);
    }
  };

  // Open Import Modal for active tab or custom type
  const handleOpenImport = (type?: 'master' | 'transaksi_masuk' | 'transaksi_keluar' | 'do_open') => {
    let modalType: 'master' | 'transaksi_masuk' | 'transaksi_keluar' | 'do_open' = type || 'transaksi_masuk';
    if (!type) {
      if (activeTab === 'master_item') modalType = 'master';
      else if (activeTab === 'transaksi_masuk') modalType = 'transaksi_masuk';
      else if (activeTab === 'transaksi_keluar') modalType = 'transaksi_keluar';
      else if (activeTab === 'do_open') modalType = 'do_open';
    }

    let colName: string = COLLECTIONS.TRANSAKSI_MASUK;
    if (modalType === 'master') colName = COLLECTIONS.MASTER_ITEMS;
    else if (modalType === 'transaksi_keluar') colName = COLLECTIONS.TRANSAKSI_KELUAR;
    else if (modalType === 'do_open') colName = COLLECTIONS.DO_OPEN;

    setImportModalConfig({
      isOpen: true,
      type: modalType,
      collectionName: colName
    });
  };

  // Handle Delete Confirmation Request
  // Dipakai RequestDoOpenView & ReportRequestDoOpenView — approve/reject/revert
  // status Request DO OPEN, sync ke local state + cache.
  const handleRequestStatusChange = (
    reqIds: string[],
    newStatus: 'APPROVED' | 'REJECTED' | 'PENDING',
    approver: string,
    reason?: string
  ) => {
    const reqSet = new Set(reqIds);
    setRequestDoOpenRecords(prev => {
      const updated = prev.map(r => {
        const matchesId = Boolean(r.id && reqSet.has(r.id));
        const matchesDocNo = Boolean(r.documentNo && reqSet.has(r.documentNo));
        if (matchesId || matchesDocNo) {
          return {
            ...r,
            status: newStatus,
            approvedBy: newStatus === 'PENDING' ? undefined : approver,
            approvedAt: newStatus === 'PENDING' ? undefined : new Date().toISOString(),
            rejectionReason: newStatus === 'PENDING' ? undefined : (reason || r.rejectionReason)
          };
        }
        return r;
      });
      const clean = deduplicateRequestDoOpen(updated);
      saveLocalCache(COLLECTIONS.REQUEST_DO_OPEN, clean, true);
      return clean;
    });
  };

  const handleRequestDeleteConfirm = (
    title: string, 
    message: string, 
    onConfirm: () => Promise<void>,
    isBulkAll = false,
    count?: number
  ) => {
    setDeleteModalConfig({
      isOpen: true,
      title,
      message,
      onConfirm,
      isBulkAll,
      count,
      loading: false
    });
  };

  // Execute Delete
  const handleConfirmDelete = async () => {
    setDeleteModalConfig(prev => ({ ...prev, loading: true }));
    try {
      await deleteModalConfig.onConfirm();
      await syncAllDataFromSupabase(false);
      showToast('Data berhasil dihapus dari database SQL Server.', 'success');
      setDeleteModalConfig(prev => ({ ...prev, isOpen: false }));
    } catch (err: any) {
      console.error(err);
      showToast(`Gagal menghapus data: ${err.message || 'Error'}`, 'error');
    } finally {
      setDeleteModalConfig(prev => ({ ...prev, loading: false }));
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white text-sm">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          Memuat Aplikasi Inventory Gudang...
        </div>
      </div>
    );
  }

  // Render Login Screen if no user profile
  if (!user) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="h-screen bg-slate-50 flex flex-col font-sans text-xs text-slate-800 antialiased overflow-hidden">
      
      {/* Top Navigation Bar */}
      <NavbarHeader
        user={user}
        onLogout={handleLogout}
        onClearAllDataPermanent={handleClearAllDataPermanent}
        onRunAutoReconcile={handleRunAutoReconcile}
        onSyncSupabase={() => syncAllDataFromSupabase(true)}
        isSyncingSupabase={isSyncingSupabase}
        isReconciling={isReconciling}
        onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
      />

      {/* Main Layout Body */}
      <div className="flex-1 w-full flex flex-col md:flex-row overflow-hidden relative">
        
        {/* Sidebar Menu */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
          userRole={user.role}
          currentUser={user}
          onLogout={handleLogout}
          pendingUserCount={usersList.filter(u => !u.isApproved).length}
          counts={{
            masterItemCount: masterItems.length,
            catalogPhotoCount: catalogPhotos.length,
            doOpenCount: new Set(
              (user.role === 'OPR'
                ? doOpen.filter(r => getDoOpenLogistikGroup(r.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)')
                : doOpen
              )
                .map(r => (r.documentNo || '').trim().toUpperCase())
                .filter(Boolean)
            ).size,
            requestDoOpenCount: new Set(
              requestDoOpenRecords
                .filter(r => r.status === 'PENDING')
                .map(r => (r.documentNo || '').trim().toUpperCase())
                .filter(Boolean)
            ).size,
            containerCount: containers.length
          }}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden">
          
          {/* Mobile Quick Breadcrumb & Menu Toggle Bar */}
          <div className="md:hidden bg-slate-900 text-white px-3 py-1.5 border-b border-slate-800 flex items-center justify-between shadow-xs text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <span className="text-slate-400 text-[10px]">Menu:</span>
              <span className="text-blue-400 font-bold">
                {activeTab === 'dashboard' && 'Dashboard'}
                {activeTab === 'master_item' && 'Daftar Master Item'}
                {activeTab === 'transaksi_masuk' && 'Transaksi Masuk'}
                {activeTab === 'transaksi_keluar' && 'Transaksi Keluar'}
                {activeTab === 'do_open' && 'DO OPEN'}
                {activeTab === 'request_do_open' && 'Request DO OPEN'}
                {activeTab === 'sisa_stock' && 'Sisa Stock'}
                {activeTab === 'rekonsiliasi_stock' && 'Rekonsiliasi Stock'}
                {activeTab === 'user_management' && 'Otorisasi User'}
                {activeTab === 'security_monitoring' && 'Keamanan'}
              </span>
            </div>

            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="flex items-center gap-1 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded shadow-xs transition"
            >
              <span>Ganti Menu</span>
            </button>
          </div>

          <main className="flex-1 p-3 sm:p-4 overflow-y-auto">
            
            {/* Toast Alert Banner */}
            {toastMessage && (
              <div className={`mb-3 p-2.5 rounded border flex items-center justify-between text-xs animate-in fade-in zoom-in duration-200 ${
                toastMessage.type === 'success' 
                  ? 'bg-emerald-600 text-white border-emerald-700' 
                  : toastMessage.type === 'error'
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-blue-600 text-white border-blue-700'
              }`}>
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>{toastMessage.text}</span>
                </div>
                <button 
                  onClick={() => setToastMessage(null)}
                  className="p-0.5 hover:bg-white/20 rounded transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Active Tab Routing with Smooth Transition.
                initial dicek document.visibilityState tiap kali tab (key) berganti:
                kalau browser tab lagi tidak visible (background tab — skenario umum
                waktu user buka link login dari WhatsApp/tab lain), animasi fade-in
                yang butuh requestAnimationFrame bisa macet permanen di opacity:0
                karena rAF di-throttle browser selama hidden — muncul sebagai halaman
                blank putih. Kalau lagi hidden, lewati animasinya (initial=false =
                langsung tampil penuh), tidak perlu nunggu rAF yang mungkin tidak
                pernah jalan. */}
            <AnimatePresence mode="sync">
              <motion.div
                key={activeTab}
                initial={document.visibilityState === 'hidden' ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {activeTab === 'dashboard' && (
                  <DashboardView
                    masterItems={masterItems}
                    transaksiMasuk={transaksiMasuk}
                    transaksiKeluar={transaksiKeluar}
                    doOpen={doOpen}
                    containers={containers}
                    userRole={user.role}
                    onNavigateTab={setActiveTab}
                    onOpenImport={handleOpenImport}
                    onRunAutoReconcile={handleRunAutoReconcile}
                  />
                )}

                {activeTab === 'master_item' && (
                  <MasterItemView
                    items={masterItems}
                    currentUser={user}
                    onOpenImport={() => handleOpenImport('master')}
                    onRequestDeleteConfirm={handleRequestDeleteConfirm}
                  />
                )}

                {activeTab === 'katalog_foto' && (
                  <CatalogPhotoView
                    catalogPhotos={catalogPhotos}
                    masterItems={masterItems}
                    transaksiMasuk={transaksiMasuk}
                    transaksiKeluar={transaksiKeluar}
                    doOpen={doOpen}
                    currentUser={user}
                    onSaveCatalogPhoto={handleSaveCatalogPhoto}
                    onBulkSaveCatalogPhotos={handleBulkSaveCatalogPhotos}
                    onDeleteCatalogPhoto={handleDeleteCatalogPhoto}
                    onSyncSupabase={() => syncAllDataFromSupabase(true)}
                    onNavigateToDoOpen={() => setActiveTab('do_open')}
                    onRequestDoOpenCreate={(newReqs) => {
                      setRequestDoOpenRecords(prev => {
                        const updated = deduplicateRequestDoOpen([...newReqs, ...prev]);
                        saveLocalCache(COLLECTIONS.REQUEST_DO_OPEN, updated, true);
                        return updated;
                      });
                    }}
                  />
                )}

                {activeTab === 'transaksi_masuk' && (
                  <TransaksiMasukView
                    records={transaksiMasuk}
                    masterItems={masterItems}
                    currentUser={user}
                    onOpenImport={() => handleOpenImport('transaksi_masuk')}
                    onRequestDeleteConfirm={handleRequestDeleteConfirm}
                  />
                )}

                {activeTab === 'transaksi_keluar' && (
                  <TransaksiKeluarView
                    records={transaksiKeluar}
                    masterItems={masterItems}
                    currentUser={user}
                    onOpenImport={() => handleOpenImport('transaksi_keluar')}
                    onRequestDeleteConfirm={handleRequestDeleteConfirm}
                    onAutoReconciledNotice={(count, docs) => {
                      showToast(`Rekonsiliasi Otomatis: ${count} DO OPEN (${docs.join(', ')}) yang cocok dengan Transaksi Keluar otomatis terhapus dari DO OPEN.`, 'info');
                    }}
                  />
                )}

                {activeTab === 'sisa_stock' && (
                  <SisaStockView
                    masterItems={masterItems}
                    transaksiMasuk={transaksiMasuk}
                    transaksiKeluar={transaksiKeluar}
                    onOpenImport={() => handleOpenImport('transaksi_masuk')}
                    onRestoreStockData={handleRestoreStockFromCacheOrFirebase}
                    isSyncing={isSyncingSupabase}
                  />
                )}

                {activeTab === 'do_open' && (
                  <DoOpenView
                    records={doOpen}
                    transaksiKeluar={transaksiKeluar}
                    requestDoOpenRecords={requestDoOpenRecords}
                    masterItems={masterItems}
                    catalogPhotos={catalogPhotos}
                    currentUser={user}
                    onOpenImport={() => handleOpenImport('do_open')}
                    onRequestDeleteConfirm={handleRequestDeleteConfirm}
                    onRunAutoReconcile={handleRunAutoReconcile}
                    onNavigateToCatalog={(itemCode) => setActiveTab('katalog_foto')}
                    onAutoReconciledNotice={(count, docs) => {
                      showToast(`Rekonsiliasi Otomatis: ${count} DO OPEN (${docs.join(', ')}) yang telah direalisasikan di Transaksi Keluar otomatis terhapus.`, 'info');
                    }}
                    onRequestDoOpenCreate={(newReqs) => {
                      setRequestDoOpenRecords(prev => {
                        const updated = deduplicateRequestDoOpen([...newReqs, ...prev]);
                        saveLocalCache(COLLECTIONS.REQUEST_DO_OPEN, updated, true);
                        return updated;
                      });
                    }}
                    onUpdateDoOpenRecord={(updatedRecord) => {
                      setDoOpen(prev => {
                        const next = prev.map(r => r.id === updatedRecord.id ? { ...r, ...updatedRecord } : r);
                        saveLocalCache(COLLECTIONS.DO_OPEN, next, true);
                        return next;
                      });
                    }}
                  />
                )}

                {activeTab === 'request_do_open' && (
                  <RequestDoOpenView
                    requests={requestDoOpenRecords}
                    masterItems={masterItems}
                    currentUser={user}
                    onOpenImport={() => handleOpenImport('do_open')}
                    onRequestDeleteConfirm={handleRequestDeleteConfirm}
                    onRequestDoOpenCreate={(newReqs) => {
                      setRequestDoOpenRecords(prev => {
                        const updated = deduplicateRequestDoOpen([...newReqs, ...prev]);
                        saveLocalCache(COLLECTIONS.REQUEST_DO_OPEN, updated, true);
                        return updated;
                      });
                    }}
                    onRequestStatusChange={handleRequestStatusChange}
                    onRequestDelete={(reqIds) => {
                      const reqSet = new Set(reqIds);
                      setRequestDoOpenRecords(prev => {
                        const updated = prev.filter(r => {
                          const matchesId = Boolean(r.id && reqSet.has(r.id));
                          const matchesDocNo = Boolean(r.documentNo && reqSet.has(r.documentNo));
                          return !matchesId && !matchesDocNo;
                        });
                        const clean = deduplicateRequestDoOpen(updated);
                        saveLocalCache(COLLECTIONS.REQUEST_DO_OPEN, clean, true);
                        return clean;
                      });
                    }}
                  />
                )}

                {activeTab === 'report_request_do' && (
                  <ReportRequestDoOpenView
                    requests={requestDoOpenRecords}
                    doOpenRecords={doOpen}
                    masterItems={masterItems}
                    currentUser={user}
                    onRequestStatusChange={handleRequestStatusChange}
                  />
                )}

                {activeTab === 'rekonsiliasi_stock' && (
                  <RekonsiliasiStockView
                    masterItems={masterItems}
                    transaksiMasuk={transaksiMasuk}
                    transaksiKeluar={transaksiKeluar}
                    doOpen={doOpen}
                    onOpenImport={() => handleOpenImport('transaksi_masuk')}
                    onRunAutoReconcile={handleRunAutoReconcile}
                    onAutoReconciledNotice={(count, docs) => {
                      showToast(`Rekonsiliasi Otomatis Selesai! ${count} DO OPEN (${docs.join(', ')}) terhapus dari database.`, 'info');
                    }}
                  />
                )}

                {activeTab === 'container_status' && (
                  <ContainerStatusView
                    containers={containers}
                    userRole={user.role}
                    showToast={showToast}
                    onRefreshData={() => syncAllDataFromSupabase(true)}
                  />
                )}

                {activeTab === 'cif_bap_container' && (
                  <CifBapContainerView
                    masterItems={masterItems}
                    containers={containers}
                    userRole={user.role}
                    showToast={showToast}
                  />
                )}

                {activeTab === 'user_management' && (user.role === 'Admin' || user.role === 'Audit') && (
                  <UserManagementView
                    currentUser={user}
                    usersList={usersList}
                    onRefreshUsers={fetchAndMergeUsers}
                  />
                )}

                {activeTab === 'security_monitoring' && user.role === 'Admin' && (
                  <SecurityMonitoringView />
                )}

                {activeTab === 'chat_bot' && (
                  <AIChatBot
                    isEmbedded={true}
                    masterItems={masterItems}
                    transaksiMasuk={transaksiMasuk}
                    transaksiKeluar={transaksiKeluar}
                    doOpen={doOpen}
                    requestDoOpen={requestDoOpenRecords}
                    containers={containers}
                    userRole={user.role}
                    userDisplayName={user.displayName}
                  />
                )}
              </motion.div>
            </AnimatePresence>

          </main>

          {/* High Density Footer */}
          <footer className="bg-slate-100 border-t border-slate-200 px-4 py-1.5 flex justify-between items-center text-[10px] text-slate-500 font-mono select-none">
            <div className="flex items-center gap-4">
              <span>View: {activeTab.toUpperCase()}</span>
              <span>Master Items: {masterItems.length}</span>
              <span>DO OPEN: {new Set(doOpen.map(d => (d.documentNo || '').trim().toUpperCase()).filter(Boolean)).size} DO</span>
            </div>
            <div>SQL Server API Engine Activated • High Density Mode</div>
          </footer>
        </div>
      </div>

      {/* Universal Import Excel Modal */}
      <ImportModal
        isOpen={importModalConfig.isOpen}
        onClose={() => setImportModalConfig(prev => ({ ...prev, isOpen: false }))}
        type={importModalConfig.type}
        collectionName={importModalConfig.collectionName}
        onSuccess={async (count, info) => {
          if (info?.isDoOpen) {
            showToast(
              `Import DO OPEN Selesai! ${info.updatedCount || 0} status No DO berhasil diperbarui & ${info.insertedCount || 0} DO baru ditambahkan (Bebas Duplikasi).`,
              'success'
            );
            try {
              const freshDoOpen = await fetchDoOpen();
              const cleanDoO = deduplicateDoOpen(freshDoOpen);
              setDoOpen(cleanDoO);
              saveLocalCache(COLLECTIONS.DO_OPEN, cleanDoO, true);

              const freshMaster = await fetchMasterItems();
              const cleanMItems = deduplicateMasterItems(freshMaster);
              setMasterItems(cleanMItems);
              saveLocalCache(COLLECTIONS.MASTER_ITEMS, cleanMItems, true);
            } catch (e) {
              console.warn('Gagal refresh doOpen & masterItems:', e);
            }
          } else {
            showToast(`Berhasil mengimport ${count} data dari file Excel!`, 'success');
            syncAllDataFromSupabase(false);
          }
        }}
      />

      {/* Universal Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={deleteModalConfig.isOpen}
        onClose={() => setDeleteModalConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmDelete}
        title={deleteModalConfig.title}
        message={deleteModalConfig.message}
        isBulkAll={deleteModalConfig.isBulkAll}
        count={deleteModalConfig.count}
        loading={deleteModalConfig.loading}
      />

      {/* Floating AI Stock Assistant ChatBot */}
      {activeTab !== 'chat_bot' && (
        <AIChatBot
          masterItems={masterItems}
          transaksiMasuk={transaksiMasuk}
          transaksiKeluar={transaksiKeluar}
          doOpen={doOpen}
          requestDoOpen={requestDoOpenRecords}
          containers={containers}
          userRole={user.role}
          userDisplayName={user.displayName}
        />
      )}

    </div>
  );
}
