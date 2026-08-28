import React, { useState, useMemo, useRef } from 'react';
import JSZip from 'jszip';
import { 
  Camera, 
  Upload, 
  Image as ImageIcon, 
  Trash2, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Download, 
  RefreshCw, 
  Eye, 
  Pencil, 
  Package, 
  Sparkles, 
  Check, 
  Grid, 
  List, 
  Plus, 
  FolderOpen,
  ArrowRight,
  FilePlus,
  ArrowUpDown,
  Calendar,
  DollarSign,
  Boxes,
  Send,
  Copy,
  Link,
  ExternalLink
} from 'lucide-react';
import { MasterItem, ItemCatalogPhoto, UserProfile, TransactionRecord, DoOpenRecord, RequestDoRecord } from '../types';
import { exportToExcel } from '../utils/excel';
import { COLLECTIONS, db, isFirestoreQuotaExceeded } from '../api';
import { addDoc, collection } from 'firebase/firestore';
import { addRequestDoOpen, convertGoogleDriveUrl, fetchGDriveFileName } from '../api';

interface CatalogPhotoViewProps {
  catalogPhotos: ItemCatalogPhoto[];
  masterItems: MasterItem[];
  transaksiMasuk?: TransactionRecord[];
  transaksiKeluar?: TransactionRecord[];
  doOpen?: DoOpenRecord[];
  currentUser: UserProfile | null;
  onSaveCatalogPhoto: (photo: ItemCatalogPhoto) => Promise<boolean>;
  onBulkSaveCatalogPhotos: (photos: ItemCatalogPhoto[]) => Promise<boolean>;
  onDeleteCatalogPhoto: (id: string) => Promise<boolean>;
  onNavigateToDoOpen?: () => void;
  onRequestDoOpenCreate?: (newRequests: RequestDoRecord[]) => void;
  initialItemCodeFilter?: string;
  onSyncSupabase?: () => void;
}

interface StagedUploadItem {
  id: string;
  file?: File;
  previewUrl: string;
  itemCode: string;
  itemName: string;
  groupName: string;
  notes: string;
  autoMatched: boolean;
  status: 'pending' | 'saving' | 'saved' | 'error';
  errorMessage?: string;
}

// Compress photo on client side to max 1000px and 0.85 JPEG quality
async function compressImage(file: File, maxWidth = 1000, maxHeight = 1000, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Gagal membaca gambar'));
      img.src = e.target?.result as string;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export const CatalogPhotoView: React.FC<CatalogPhotoViewProps> = ({
  catalogPhotos,
  masterItems,
  transaksiMasuk = [],
  transaksiKeluar = [],
  doOpen = [],
  currentUser,
  onSaveCatalogPhoto,
  onBulkSaveCatalogPhotos,
  onDeleteCatalogPhoto,
  onNavigateToDoOpen,
  onRequestDoOpenCreate,
  initialItemCodeFilter = '',
  onSyncSupabase
}) => {
  const [activeTabMode, setActiveTabMode] = useState<'gallery' | 'upload'>('gallery');
  const [viewStyle, setViewStyle] = useState<'grid' | 'table'>('grid');
  
  // Search & Filter & Sorting
  const [searchQuery, setSearchQuery] = useState(initialItemCodeFilter);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [photoFilterStatus, setPhotoFilterStatus] = useState<'ALL' | 'HAS_PHOTO' | 'NO_PHOTO'>('HAS_PHOTO');
  const [sortBy, setSortBy] = useState<'qty_desc' | 'qty_asc' | 'code_asc' | 'name_asc'>('qty_desc');

  // Pagination — render 13 ribu+ kartu/baris sekaligus (apalagi dengan foto asli,
  // bukan placeholder) yang bikin halaman ini nge-lag parah. Pola sama seperti
  // MasterItemView/TransaksiMasukView/dst.
  const PAGE_SIZE = 48;
  const [page, setPage] = useState(1);

  // Lightbox Modal
  const [selectedLightboxPhoto, setSelectedLightboxPhoto] = useState<ItemCatalogPhoto | null>(null);

  // Request DO OPEN Modal State
  const [requestModalItem, setRequestModalItem] = useState<{ item: MasterItem; photo?: ItemCatalogPhoto } | null>(null);
  const [reqDocNo, setReqDocNo] = useState('');
  const [reqQty, setReqQty] = useState<number | ''>(1);
  const [reqDate, setReqDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reqFromLoc, setReqFromLoc] = useState('GUDANG UTAMA');
  const [reqToLoc, setReqToLoc] = useState('LOGISTIK');
  const [reqRemark, setReqRemark] = useState('');
  const [isSubmittingReq, setIsSubmittingReq] = useState(false);
  const [reqNotice, setReqNotice] = useState<string | null>(null);
  const [copiedCodeNotice, setCopiedCodeNotice] = useState<string | null>(null);

  // Bulk Upload Staging State
  const [stagedFiles, setStagedFiles] = useState<StagedUploadItem[]>([]);
  const [batchAssignItemCode, setBatchAssignItemCode] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Google Drive & Image Link Input State
  const [uploadSourceType, setUploadSourceType] = useState<'file' | 'gdrive_single' | 'gdrive_bulk'>('file');
  const [gdriveItemCode, setGdriveItemCode] = useState('');
  const [gdriveUrl, setGdriveUrl] = useState('');
  const [gdriveNotes, setGdriveNotes] = useState('');

  // Bulk Google Drive Links Parser State
  const [bulkGdriveText, setBulkGdriveText] = useState('');
  const [defaultBulkNotes, setDefaultBulkNotes] = useState('Foto dari Link GDrive Massal');
  const [defaultBulkItemCode, setDefaultBulkItemCode] = useState('');
  const [isFetchingGDriveNames, setIsFetchingGDriveNames] = useState(false);
  const [gdriveFetchProgress, setGdriveFetchProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Sequential Paste List Codes State
  const [showPasteCodesBox, setShowPasteCodesBox] = useState(false);
  const [pasteCodesText, setPasteCodesText] = useState('');

  const handleApplyPastedCodes = () => {
    if (!pasteCodesText.trim()) return;
    const lines = pasteCodesText.split('\n').map(l => l.replace(/\.(jpg|jpeg|png|webp|gif|bmp)$/i, '').trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    let assignedCount = 0;
    let autoMatchCount = 0;

    const updated = stagedFiles.map((item, idx) => {
      if (idx < lines.length) {
        const cleanCode = lines[idx].toUpperCase();
        const matched = masterItems.find(m => m.itemCode.toUpperCase() === cleanCode);
        if (matched) autoMatchCount++;
        assignedCount++;
        return {
          ...item,
          itemCode: cleanCode,
          itemName: matched ? matched.itemName : cleanCode,
          groupName: matched ? matched.groupName : item.groupName,
          autoMatched: Boolean(matched)
        };
      }
      return item;
    });

    setStagedFiles(updated);
    setPasteCodesText('');
    setShowPasteCodesBox(false);
    setUploadNotice({
      text: `Berhasil menerapkan ${assignedCount} Kode Barang dari teks tempelan secara berurutan ke Staging! (${autoMatchCount} terhubung ke Master Item).`,
      type: 'success'
    });
  };

  const handleAddGdriveLinkToStaging = () => {
    if (!gdriveUrl.trim()) {
      setUploadNotice({ text: 'Mohon masukkan Link Google Drive atau URL Foto!', type: 'error' });
      return;
    }

    const formattedUrl = convertGoogleDriveUrl(gdriveUrl);
    const cleanCode = gdriveItemCode.trim().toUpperCase();
    const matchedItem = masterItems.find(m => m.itemCode.toUpperCase() === cleanCode);

    const newStaged: StagedUploadItem = {
      id: `staged_link_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      previewUrl: formattedUrl,
      itemCode: cleanCode,
      itemName: matchedItem ? matchedItem.itemName : (cleanCode || 'Foto Katalog'),
      groupName: matchedItem ? matchedItem.groupName : '',
      notes: gdriveNotes || 'Foto dari Link Google Drive',
      autoMatched: Boolean(matchedItem),
      status: 'pending'
    };

    setStagedFiles(prev => [...prev, newStaged]);
    setGdriveUrl('');
    setGdriveNotes('');
    setUploadNotice({
      text: `Berhasil menambahkan foto dari Link Google Drive! Foto telah masuk ke Daftar Staging (${cleanCode || 'Tanpa Kode'}). Klik 'Simpan Semua Ke Katalog' untuk menyimpan secara permanen.`,
      type: 'success'
    });
  };

  // Auto Fetch Real Filename from Google Drive
  const handleAutoFetchGDriveNames = async (itemsToFetch?: StagedUploadItem[]) => {
    const list = itemsToFetch || stagedFiles;
    let targetItems = itemsToFetch || list.filter(s => !s.itemCode || s.itemCode === '' || s.itemCode === 'FOTO KATALOG' || s.itemCode.includes('STAGED') || s.itemCode.includes('GDRIVE'));

    if (targetItems.length === 0) {
      targetItems = list.filter(s => s.previewUrl.includes('google') || s.previewUrl.includes('lh3'));
    }

    if (targetItems.length === 0) {
      setUploadNotice({ text: 'Tidak ada foto link Google Drive di staging untuk dideteksi!', type: 'info' });
      return;
    }

    setIsFetchingGDriveNames(true);
    setGdriveFetchProgress({ current: 0, total: targetItems.length });
    let successCount = 0;

    let updatedStaged = [...stagedFiles];

    for (let i = 0; i < targetItems.length; i++) {
      const item = targetItems[i];
      setGdriveFetchProgress({ current: i + 1, total: targetItems.length });

      try {
        const detectedName = await fetchGDriveFileName(item.previewUrl);
        if (detectedName) {
          const cleanCode = detectedName.trim().toUpperCase();
          const matchedItem = masterItems.find(m => m.itemCode.toUpperCase() === cleanCode);

          updatedStaged = updatedStaged.map(s => {
            if (s.id === item.id) {
              return {
                ...s,
                itemCode: cleanCode,
                itemName: matchedItem ? matchedItem.itemName : cleanCode,
                groupName: matchedItem ? matchedItem.groupName : s.groupName,
                autoMatched: Boolean(matchedItem)
              };
            }
            return s;
          });
          successCount++;
        }
      } catch (err) {
        console.warn('Error fetching GDrive filename:', err);
      }
    }

    setStagedFiles(updatedStaged);
    setIsFetchingGDriveNames(false);

    if (successCount > 0) {
      setUploadNotice({
        text: `✨ Berhasil mendapatkan & menerapkan ${successCount} Nama File / Kode Barang asli dari Google Drive!`,
        type: 'success'
      });
    } else {
      setUploadNotice({
        text: 'Google Drive membatasi deteksi nama file otomatis via CORS. Gunakan tombol "📋 Paste Daftar Kode Barang" untuk menempelkan daftar kode barang sekaligus!',
        type: 'info'
      });
      setShowPasteCodesBox(true);
    }
  };

  // Sequentially assign item codes from master items list to blank staging cards
  const handleSequentialMatchMasterItems = () => {
    if (stagedFiles.length === 0) return;
    if (masterItems.length === 0) {
      setUploadNotice({ text: 'Data Master Barang masih kosong!', type: 'error' });
      return;
    }

    let updatedCount = 0;
    let masterIndex = 0;

    const updated = stagedFiles.map((s) => {
      if (!s.itemCode || s.itemCode === '' || s.itemCode === 'FOTO KATALOG') {
        const master = masterItems[masterIndex % masterItems.length];
        masterIndex++;
        updatedCount++;
        return {
          ...s,
          itemCode: master.itemCode,
          itemName: master.itemName,
          groupName: master.groupName,
          autoMatched: true
        };
      }
      return s;
    });

    setStagedFiles(updated);
    setUploadNotice({
      text: `Berhasil memasangkan Kode Barang berurutan dari Master Item ke ${updatedCount} foto!`,
      type: 'success'
    });
  };

  const handleProcessBulkGdriveLinks = () => {
    if (!bulkGdriveText.trim()) {
      setUploadNotice({ text: 'Mohon tempelkan/paste link Google Drive atau data dari Excel terlebih dahulu!', type: 'error' });
      return;
    }

    const rawLines = bulkGdriveText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length === 0) return;

    const newStagedItems: StagedUploadItem[] = [];
    let autoMatchCount = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      
      const isCurrentUrl = line.startsWith('http') || line.includes('drive.google') || line.includes('googleusercontent');
      const nextLine = rawLines[i + 1];
      const isNextUrl = nextLine ? (nextLine.startsWith('http') || nextLine.includes('drive.google') || nextLine.includes('googleusercontent')) : false;

      // Pattern A: Alternating Lines (Line 1 = "ABC241000010.jpg", Line 2 = "https://drive.google...")
      if (!isCurrentUrl && nextLine && isNextUrl) {
        const extractedCode = line.replace(/\.(jpg|jpeg|png|webp|gif|bmp)$/i, '').trim();
        const formattedUrl = convertGoogleDriveUrl(nextLine);
        const cleanCode = extractedCode.toUpperCase();
        const matchedItem = masterItems.find(m => m.itemCode.toUpperCase() === cleanCode);
        if (matchedItem) autoMatchCount++;

        newStagedItems.push({
          id: `staged_bulk_gdrive_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
          previewUrl: formattedUrl,
          itemCode: cleanCode,
          itemName: matchedItem ? matchedItem.itemName : (cleanCode || 'Foto Katalog'),
          groupName: matchedItem ? matchedItem.groupName : '',
          notes: defaultBulkNotes || 'Foto Link Massal GDrive',
          autoMatched: Boolean(matchedItem),
          status: 'pending'
        });
        i++; // Skip next line (URL)
        continue;
      }

      // Pattern B: Same Line Tab/Comma/Space Separated
      let itemCode = '';
      let url = '';
      let notes = defaultBulkNotes || 'Foto Link Massal GDrive';

      if (line.includes('\t')) {
        const parts = line.split('\t').map(p => p.trim());
        const urlIndex = parts.findIndex(p => p.startsWith('http') || p.includes('drive.google') || p.includes('googleusercontent'));
        if (urlIndex !== -1) {
          url = parts[urlIndex];
          const codePart = parts.find((p, idx) => idx !== urlIndex && p.length > 0);
          if (codePart) itemCode = codePart.replace(/\.(jpg|jpeg|png|webp|gif|bmp)$/i, '');
          const notesPart = parts.find((p, idx) => idx !== urlIndex && p !== codePart && p.length > 0);
          if (notesPart) notes = notesPart;
        }
      } else if (line.includes(',')) {
        const parts = line.split(',').map(p => p.trim());
        const urlIndex = parts.findIndex(p => p.startsWith('http') || p.includes('drive.google') || p.includes('googleusercontent'));
        if (urlIndex !== -1) {
          url = parts[urlIndex];
          const codePart = parts.find((p, idx) => idx !== urlIndex && p.length > 0);
          if (codePart) itemCode = codePart.replace(/\.(jpg|jpeg|png|webp|gif|bmp)$/i, '');
        }
      }

      if (!url) {
        const spaceParts = line.split(/\s+/);
        const urlIndex = spaceParts.findIndex(p => p.startsWith('http') || p.includes('drive.google') || p.includes('googleusercontent'));
        if (urlIndex !== -1) {
          url = spaceParts[urlIndex];
          const codePart = spaceParts.find((p, idx) => idx !== urlIndex && p.length > 0);
          if (codePart) itemCode = codePart.replace(/\.(jpg|jpeg|png|webp|gif|bmp)$/i, '');
        } else if (isCurrentUrl) {
          url = line;
        }
      }

      if (!url) continue;

      // Extract code from filename if extension exists in string (e.g. ABC241000010.jpg)
      if (!itemCode) {
        const fileCodeMatch = line.match(/([a-zA-Z0-9_-]{3,30})\.(jpg|jpeg|png|webp|gif|bmp)/i);
        if (fileCodeMatch && fileCodeMatch[1]) {
          itemCode = fileCodeMatch[1];
        } else if (defaultBulkItemCode.trim()) {
          itemCode = defaultBulkItemCode.trim();
        }
      }

      const cleanCode = itemCode.trim().toUpperCase();
      const formattedUrl = convertGoogleDriveUrl(url);

      const matchedItem = masterItems.find(m => m.itemCode.toUpperCase() === cleanCode);
      if (matchedItem) autoMatchCount++;

      newStagedItems.push({
        id: `staged_bulk_gdrive_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
        previewUrl: formattedUrl,
        itemCode: cleanCode,
        itemName: matchedItem ? matchedItem.itemName : (cleanCode || 'Foto Katalog'),
        groupName: matchedItem ? matchedItem.groupName : '',
        notes: notes,
        autoMatched: Boolean(matchedItem),
        status: 'pending'
      });
    }

    if (newStagedItems.length === 0) {
      setUploadNotice({ text: 'Tidak ada URL / Link Google Drive valid yang berhasil terdeteksi dari teks yang dimasukkan.', type: 'error' });
      return;
    }

    setStagedFiles(prev => [...prev, ...newStagedItems]);
    setBulkGdriveText('');

    const blankCount = newStagedItems.filter(s => !s.itemCode).length;
    if (blankCount > 0) {
      setUploadNotice({
        text: `Berhasil menambahkan ${newStagedItems.length} foto ke Staging! Mencoba mengambil nama file Google Drive untuk ${blankCount} foto...`,
        type: 'info'
      });
      setTimeout(() => {
        handleAutoFetchGDriveNames(newStagedItems);
      }, 300);
    } else {
      setUploadNotice({
        text: `Berhasil menambahkan ${newStagedItems.length} foto dari Link Google Drive/Excel ke Daftar Staging! (${autoMatchCount} terhubung otomatis dengan Master Item).`,
        type: 'success'
      });
    }
  };

  // Download All Catalog Photos as ZIP State & Handler
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number; stage: string; percent: number }>({
    current: 0,
    total: 0,
    stage: 'Memulai...',
    percent: 0,
  });

  const handleDownloadAllPhotosZip = async () => {
    if (catalogPhotos.length === 0) {
      setUploadNotice({
        text: 'Tidak ada foto katalog yang tersedia untuk di-download.',
        type: 'error'
      });
      return;
    }

    setIsDownloadingZip(true);
    setZipProgress({
      current: 0,
      total: catalogPhotos.length,
      stage: 'Mengumpulkan data foto katalog...',
      percent: 0
    });

    try {
      const zip = new JSZip();
      const folder = zip.folder('Foto_Katalog_Item') || zip;
      const itemCodeCountMap = new Map<string, number>();

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < catalogPhotos.length; i++) {
        const photo = catalogPhotos[i];
        const rawCode = (photo.itemCode || 'ITEM_TANPA_KODE').trim();
        // Sanitize itemCode for valid file name
        const cleanCode = rawCode.replace(/[\/\\?%*:|"<>]/g, '_');

        // Manage duplicate item codes filename suffix (e.g., ITEMCODE.jpg, ITEMCODE_2.jpg)
        const count = (itemCodeCountMap.get(cleanCode) || 0) + 1;
        itemCodeCountMap.set(cleanCode, count);

        const filename = count > 1 ? `${cleanCode}_${count}.jpg` : `${cleanCode}.jpg`;

        setZipProgress({
          current: i + 1,
          total: catalogPhotos.length,
          stage: `Mengambil foto (${i + 1}/${catalogPhotos.length}): ${rawCode}`,
          percent: Math.round(((i + 1) / catalogPhotos.length) * 80)
        });

        try {
          if (photo.photoUrl.startsWith('data:')) {
            // Base64 Data URL
            const base64Content = photo.photoUrl.split(',')[1];
            if (base64Content) {
              folder.file(filename, base64Content, { base64: true });
              successCount++;
            }
          } else if (photo.photoUrl.startsWith('http://') || photo.photoUrl.startsWith('https://') || photo.photoUrl.startsWith('blob:')) {
            // Remote HTTP URL or Blob URL
            const response = await fetch(photo.photoUrl);
            if (response.ok) {
              const blob = await response.blob();
              folder.file(filename, blob);
              successCount++;
            } else {
              failCount++;
            }
          } else {
            failCount++;
          }
        } catch (err) {
          console.error(`Gagal memproses foto ${rawCode}:`, err);
          failCount++;
        }
      }

      setZipProgress({
        current: catalogPhotos.length,
        total: catalogPhotos.length,
        stage: 'Mengompres seluruh foto ke file ZIP...',
        percent: 85
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setZipProgress(prev => ({
          ...prev,
          percent: 85 + Math.round((metadata.percent / 100) * 15)
        }));
      });

      // Trigger Automatic Browser Download
      const todayStr = new Date().toISOString().slice(0, 10);
      const downloadUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `All_Foto_Katalog_${todayStr}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setUploadNotice({
        text: `Berhasil men-download ${successCount} foto katalog ke file ZIP (${failCount > 0 ? `${failCount} foto gagal` : 'semua foto berhasil'}). Setiap file dinamai dengan Item Code.`,
        type: 'success'
      });
    } catch (error: any) {
      console.error('Error zipping catalog photos:', error);
      setUploadNotice({
        text: `Terjadi kesalahan saat membuat file ZIP: ${error.message || 'Gagal'}`,
        type: 'error'
      });
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Master Items Map for easy lookup
  const masterMap = useMemo(() => {
    const map = new Map<string, MasterItem>();
    masterItems.forEach(m => map.set(m.itemCode, m));
    return map;
  }, [masterItems]);

  // Catalog Photo Map by Item Code (Flexible case and whitespace matching)
  const photoMapByItemCode = useMemo(() => {
    const map = new Map<string, ItemCatalogPhoto>();
    catalogPhotos.forEach(p => {
      if (p.itemCode) {
        const raw = String(p.itemCode).trim();
        map.set(raw, p);
        map.set(raw.toUpperCase(), p);
        map.set(raw.toLowerCase(), p);
      }
    });
    return map;
  }, [catalogPhotos]);

  // Extract Groups
  const availableGroups = useMemo(() => {
    const groups = new Set<string>();
    masterItems.forEach(m => {
      if (m.groupName) groups.add(m.groupName);
    });
    return Array.from(groups).sort();
  }, [masterItems]);

  // Extract Years from CreatedDate / CreatedAt for Filter
  const getItemYear = (item: MasterItem, photo?: ItemCatalogPhoto) => {
    const dtStr = item.createdDate || item.createdAt || photo?.createdAt || '';
    const match = dtStr.match(/\b(20\d\d|19\d\d)\b/);
    return match ? match[1] : 'Lainnya';
  };

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    masterItems.forEach(m => {
      const photo = photoMapByItemCode.get(m.itemCode);
      const dtStr = m.createdDate || m.createdAt || photo?.createdAt || '';
      const match = dtStr.match(/\b(20\d\d|19\d\d)\b/);
      if (match) years.add(match[1]);
    });
    catalogPhotos.forEach(p => {
      if (p.createdAt) {
        const match = p.createdAt.match(/\b(20\d\d|19\d\d)\b/);
        if (match) years.add(match[1]);
      }
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [masterItems, catalogPhotos, photoMapByItemCode]);

  // Handle Drag & Drop / File Selection
  const handleFilesSelected = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsProcessingFiles(true);
    setUploadNotice(null);

    const newStaged: StagedUploadItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;

      try {
        const compressedDataUrl = await compressImage(file);
        
        // Auto-match Item Code from filename
        // e.g., "ITM-001_front.jpg" -> clean filename "ITM-001"
        const cleanFileName = file.name.replace(/\.[^/.]+$/, '').trim().toUpperCase();
        
        let matchedItem: MasterItem | undefined;
        // 1. Exact match by item code
        matchedItem = masterItems.find(m => m.itemCode.toUpperCase() === cleanFileName);
        
        // 2. Contains match
        if (!matchedItem) {
          matchedItem = masterItems.find(m => 
            cleanFileName.includes(m.itemCode.toUpperCase()) || 
            m.itemCode.toUpperCase().includes(cleanFileName)
          );
        }

        const itemCode = matchedItem ? matchedItem.itemCode : '';
        const itemName = matchedItem ? matchedItem.itemName : '';
        const groupName = matchedItem ? matchedItem.groupName : '';

        newStaged.push({
          id: `staged_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
          file,
          previewUrl: compressedDataUrl,
          itemCode,
          itemName,
          groupName,
          notes: '',
          autoMatched: Boolean(matchedItem),
          status: 'pending'
        });
      } catch (err) {
        console.error('Error compressing image:', err);
      }
    }

    setStagedFiles(prev => [...prev, ...newStaged]);
    setIsProcessingFiles(false);
    setActiveTabMode('upload');

    if (newStaged.length > 0) {
      const autoMatchedCount = newStaged.filter(s => s.autoMatched).length;
      setUploadNotice({
        text: `Berhasil memuat ${newStaged.length} foto! ${autoMatchedCount > 0 ? `${autoMatchedCount} foto otomatis cocok dengan Kode Barang Master.` : 'Silakan pilih Kode Barang untuk setiap foto.'}`,
        type: 'info'
      });
    }
  };

  // Batch Apply selected Item Code to all staged photos
  const handleApplyBatchItemCode = () => {
    if (!batchAssignItemCode) return;
    const selectedMaster = masterMap.get(batchAssignItemCode);

    setStagedFiles(prev => prev.map(item => ({
      ...item,
      itemCode: batchAssignItemCode,
      itemName: selectedMaster ? selectedMaster.itemName : item.itemName,
      groupName: selectedMaster ? selectedMaster.groupName : item.groupName,
      notes: batchNotes ? batchNotes : item.notes
    })));

    setUploadNotice({
      text: `Kode Barang '${batchAssignItemCode}' berhasil diterapkan ke seluruh ${stagedFiles.length} foto upload!`,
      type: 'success'
    });
  };

  // Remove single item from staging
  const handleRemoveStaged = (id: string) => {
    setStagedFiles(prev => prev.filter(s => s.id !== id));
  };

  // Save all staged photos to Catalog
  const handleSaveAllStaged = async () => {
    if (stagedFiles.length === 0) return;

    // Validate that all items have an itemCode
    const invalidItem = stagedFiles.find(s => !s.itemCode || s.itemCode.trim() === '');
    if (invalidItem) {
      setUploadNotice({
        text: 'Mohon pastikan seluruh foto telah memiliki Kode Barang yang valid dari Master Item!',
        type: 'error'
      });
      return;
    }

    setIsSavingBatch(true);
    setUploadNotice(null);

    const payload: ItemCatalogPhoto[] = stagedFiles.map(s => {
      const m = masterMap.get(s.itemCode);
      return {
        id: `photo_${s.itemCode}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        itemCode: s.itemCode,
        itemName: m ? m.itemName : s.itemName,
        groupName: m ? m.groupName : s.groupName,
        photoUrl: s.previewUrl,
        notes: s.notes || 'Foto Katalog Barang',
        createdAt: new Date().toISOString()
      };
    });

    try {
      const success = await onBulkSaveCatalogPhotos(payload);
      if (success) {
        setUploadNotice({
          text: `Berhasil menyimpan ${payload.length} Foto Katalog Barang ke Database & Cache! Data sudah langsung terintegrasi ke Menu DO OPEN.`,
          type: 'success'
        });
        setStagedFiles([]);
        setActiveTabMode('gallery');
      } else {
        setUploadNotice({
          text: 'Terjadi kendala saat menyimpan foto katalog. Silakan coba kembali.',
          type: 'error'
        });
      }
    } catch (err: any) {
      console.error(err);
      setUploadNotice({
        text: `Gagal menyimpan: ${err.message || 'Error'}`,
        type: 'error'
      });
    } finally {
      setIsSavingBatch(false);
    }
  };

  // Calculate Stock Statistics per Item Code
  const stockStatsMap = useMemo(() => {
    const map = new Map<string, {
      totalMasuk: number;
      totalKeluar: number;
      sisaStock: number;
      sisaNilaiBeli: number;
      sisaNilaiJual: number;
      doOpenCount: number;
      doOpenQty: number;
      doOpenNilaiBeli: number;
      doOpenNilaiJual: number;
      qtyLepasan: number;
      lepasanNilaiBeli: number;
      lepasanNilaiJual: number;
    }>();

    // Sum Transaksi Masuk
    (transaksiMasuk || []).forEach(t => {
      if (!t.itemCode) return;
      const code = t.itemCode.trim().toUpperCase();
      const curr = map.get(code) || { totalMasuk: 0, totalKeluar: 0, sisaStock: 0, sisaNilaiBeli: 0, sisaNilaiJual: 0, doOpenCount: 0, doOpenQty: 0, doOpenNilaiBeli: 0, doOpenNilaiJual: 0, qtyLepasan: 0, lepasanNilaiBeli: 0, lepasanNilaiJual: 0 };
      curr.totalMasuk += Number(t.qty || 0);
      map.set(code, curr);
    });

    // Sum Transaksi Keluar
    (transaksiKeluar || []).forEach(t => {
      if (!t.itemCode) return;
      const code = t.itemCode.trim().toUpperCase();
      const curr = map.get(code) || { totalMasuk: 0, totalKeluar: 0, sisaStock: 0, sisaNilaiBeli: 0, sisaNilaiJual: 0, doOpenCount: 0, doOpenQty: 0, doOpenNilaiBeli: 0, doOpenNilaiJual: 0, qtyLepasan: 0, lepasanNilaiBeli: 0, lepasanNilaiJual: 0 };
      curr.totalKeluar += Number(t.qty || 0);
      map.set(code, curr);
    });

    // Sum DO OPEN
    (doOpen || []).forEach(d => {
      if (!d.itemCode) return;
      const code = d.itemCode.trim().toUpperCase();
      const curr = map.get(code) || { totalMasuk: 0, totalKeluar: 0, sisaStock: 0, sisaNilaiBeli: 0, sisaNilaiJual: 0, doOpenCount: 0, doOpenQty: 0, doOpenNilaiBeli: 0, doOpenNilaiJual: 0, qtyLepasan: 0, lepasanNilaiBeli: 0, lepasanNilaiJual: 0 };
      curr.doOpenCount += 1;
      curr.doOpenQty += Number(d.qty || 0);
      map.set(code, curr);
    });

    // Calculate Sisa, DO Open, and Qty Lepasan values using Master Item hargaBeli & hargaJual
    masterItems.forEach(item => {
      const code = item.itemCode.trim().toUpperCase();
      const curr = map.get(code) || { totalMasuk: 0, totalKeluar: 0, sisaStock: 0, sisaNilaiBeli: 0, sisaNilaiJual: 0, doOpenCount: 0, doOpenQty: 0, doOpenNilaiBeli: 0, doOpenNilaiJual: 0, qtyLepasan: 0, lepasanNilaiBeli: 0, lepasanNilaiJual: 0 };
      const hb = Number(item.hargaBeli || 0);
      const hj = Number(item.hargaJual || 0);
      curr.sisaStock = curr.totalMasuk - curr.totalKeluar;
      curr.sisaNilaiBeli = curr.sisaStock * hb;
      curr.sisaNilaiJual = curr.sisaStock * hj;
      curr.doOpenNilaiBeli = curr.doOpenQty * hb;
      curr.doOpenNilaiJual = curr.doOpenQty * hj;
      curr.qtyLepasan = curr.sisaStock - curr.doOpenQty;
      curr.lepasanNilaiBeli = curr.qtyLepasan * hb;
      curr.lepasanNilaiJual = curr.qtyLepasan * hj;
      map.set(code, curr);
    });

    return map;
  }, [transaksiMasuk, transaksiKeluar, doOpen, masterItems]);

  // Filtered Master Items for Display in Gallery Table / Cards
  const filteredItems = useMemo(() => {
    return masterItems.filter(item => {
      const q = searchQuery.trim().toLowerCase();
      const photo = photoMapByItemCode.get(item.itemCode);

      const matchesSearch = !q || 
        item.itemCode.toLowerCase().includes(q) || 
        item.itemName.toLowerCase().includes(q) || 
        item.groupName.toLowerCase().includes(q) ||
        (photo && photo.notes && photo.notes.toLowerCase().includes(q));

      const matchesGroup = !selectedGroup || item.groupName === selectedGroup;

      const matchesPhotoStatus = 
        photoFilterStatus === 'ALL' || 
        (photoFilterStatus === 'HAS_PHOTO' && Boolean(photo)) || 
        (photoFilterStatus === 'NO_PHOTO' && !photo);

      const itemYr = getItemYear(item, photo);
      const matchesYear = !selectedYear || itemYr === selectedYear;

      return matchesSearch && matchesGroup && matchesPhotoStatus && matchesYear;
    });
  }, [masterItems, photoMapByItemCode, searchQuery, selectedGroup, photoFilterStatus, selectedYear]);

  // Sorted Filtered Items (Default: Qty Terbanyak -> Qty Sedikit)
  const sortedFilteredItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const codeA = a.itemCode.trim().toUpperCase();
      const codeB = b.itemCode.trim().toUpperCase();
      const statsA = stockStatsMap.get(codeA) || { sisaStock: 0 };
      const statsB = stockStatsMap.get(codeB) || { sisaStock: 0 };

      if (sortBy === 'qty_desc') {
        return statsB.sisaStock - statsA.sisaStock;
      } else if (sortBy === 'qty_asc') {
        return statsA.sisaStock - statsB.sisaStock;
      } else if (sortBy === 'code_asc') {
        return codeA.localeCompare(codeB);
      } else if (sortBy === 'name_asc') {
        return a.itemName.localeCompare(b.itemName);
      }
      return statsB.sisaStock - statsA.sisaStock;
    });
  }, [filteredItems, stockStatsMap, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sortedFilteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedFilteredItems.slice(start, start + PAGE_SIZE);
  }, [sortedFilteredItems, safePage]);

  React.useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedGroup, selectedYear, photoFilterStatus, sortBy]);

  // Copy Item Code Handler
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeNotice(code);
    setTimeout(() => setCopiedCodeNotice(null), 2000);
  };

  // Open Request DO OPEN Modal
  const handleOpenRequestModal = (item: MasterItem) => {
    const photo = photoMapByItemCode.get(item.itemCode);
    setRequestModalItem({ item, photo });
    setReqDocNo(`REQ-${item.itemCode}-${Math.floor(100 + Math.random() * 900)}`);
    setReqQty(1);
    setReqDate(new Date().toISOString().slice(0, 10));
    setReqFromLoc('GUDANG UTAMA');
    setReqToLoc('LOGISTIK');
    setReqRemark(`Request DO OPEN via Katalog Foto (${item.itemCode})`);
    setReqNotice(null);
  };

  // Submit Request DO OPEN
  const handleSubmitRequestDoOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestModalItem) return;
    if (!reqDocNo.trim() || !reqQty || Number(reqQty) <= 0) {
      setReqNotice('Nomor DO dan Jumlah Qty (>0) wajib diisi.');
      return;
    }

    setIsSubmittingReq(true);
    setReqNotice(null);

    const { item } = requestModalItem;
    const newReqPayload: RequestDoRecord = {
      id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      doOpenId: '',
      postingDate: reqDate,
      entryName: currentUser?.displayName || currentUser?.email || 'User Operational',
      documentNo: reqDocNo.trim().toUpperCase(),
      itemCode: item.itemCode,
      category: 'REQUEST DARI KATALOG FOTO',
      remark: reqRemark.trim(),
      qty: Number(reqQty),
      fromLocation: reqFromLoc.trim(),
      toLocation: reqToLoc.trim(),
      requestedBy: currentUser?.displayName || currentUser?.email || 'User Operational',
      requestedAt: new Date().toISOString(),
      requestKirimDate: reqDate,
      status: 'PENDING'
    };

    try {
      if (!isFirestoreQuotaExceeded) {
        try {
          await addDoc(collection(db, COLLECTIONS.REQUEST_DO_OPEN), newReqPayload);
        } catch (err) {
          console.warn('Firestore addDoc request_do_open notice:', err);
        }
      }

      // WAJIB cek hasilnya — addRequestDoOpen balikin true/false (bukan
      // throw) kalau gagal, jadi kalau tidak dicek, request yang gagal
      // simpan tetap keliatan "berhasil" di layar padahal tidak pernah
      // masuk database.
      const savedOk = await addRequestDoOpen(newReqPayload);
      if (!savedOk) {
        throw new Error('Server menolak permintaan (sesi mungkin sudah kedaluwarsa, coba login ulang).');
      }

      if (onRequestDoOpenCreate) {
        onRequestDoOpenCreate([newReqPayload]);
      }

      setUploadNotice({
        text: `Berhasil mengajukan Request DO OPEN untuk ${item.itemCode} (${item.itemName}) sejumlah ${reqQty} Pcs!`,
        type: 'success'
      });
      setRequestModalItem(null);
    } catch (err: any) {
      console.error(err);
      setReqNotice(`Gagal membuat Request DO OPEN: ${err.message || 'Error'}`);
    } finally {
      setIsSubmittingReq(false);
    }
  };

  // Statistics
  const totalMasterItems = masterItems.length;
  const totalPhotosUploaded = catalogPhotos.length;
  const itemsWithPhotoCount = useMemo(() => {
    let count = 0;
    masterItems.forEach(m => {
      if (photoMapByItemCode.has(m.itemCode)) count++;
    });
    return count;
  }, [masterItems, photoMapByItemCode]);

  const itemsWithoutPhotoCount = totalMasterItems - itemsWithPhotoCount;

  // Export Catalog Data to Excel
  const handleExportCatalogExcel = () => {
    const exportData = masterItems.map(item => {
      const photo = photoMapByItemCode.get(item.itemCode);
      return {
        'Kode Barang': item.itemCode,
        'Nama Barang': item.itemName,
        'Group Item': item.groupName,
        'Status Foto': photo ? 'ADA FOTO' : 'BELUM ADA FOTO',
        'Catatan Foto': photo?.notes || '-',
        'Tanggal Upload': photo?.createdAt ? photo.createdAt.slice(0, 10) : '-'
      };
    });

    exportToExcel(exportData, `Katalog_Foto_Barang_${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <div className="space-y-4 pb-8">
      
      {/* View Header */}
      <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/30 text-blue-400 border border-blue-500/40 rounded-lg">
            <Camera className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <span>Katalog Foto Barang</span>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded-full">
                Integrated DO OPEN
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Upload foto barang massal & integrasikan gambar produk secara otomatis ke Menu DO OPEN.
            </p>
          </div>
        </div>

        {/* Action Buttons Header */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-lg text-xs flex items-center gap-2 shadow-sm transition cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Foto Massal</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
            multiple
            accept="image/*"
            className="hidden"
          />

          <button
            onClick={handleExportCatalogExcel}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
            title="Export Rekap Katalog Foto ke Excel"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Excel Katalog</span>
          </button>

          {onNavigateToDoOpen && (
            <button
              onClick={onNavigateToDoOpen}
              className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              title="Lihat Gambar Produk di Menu DO OPEN"
            >
              <FolderOpen className="w-4 h-4 text-emerald-400" />
              <span>Cek Menu DO OPEN</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Summary Metrics Cards - Only shown for Audit Role */}
      {(currentUser?.role?.toLowerCase() === 'audit' || currentUser?.role === 'Audit') && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-500">Total Foto Katalog</div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">{totalPhotosUploaded} <span className="text-xs font-normal text-slate-500">Foto</span></div>
            </div>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <ImageIcon className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-500">Master Item Terfoto</div>
              <div className="text-lg font-bold text-emerald-600 mt-0.5">{itemsWithPhotoCount} / {totalMasterItems}</div>
            </div>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-500">Item Belum Ada Foto</div>
              <div className="text-lg font-bold text-amber-600 mt-0.5">{itemsWithoutPhotoCount} <span className="text-xs font-normal text-slate-500">Item</span></div>
            </div>
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600 border border-amber-100">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-500">Kelengkapan Katalog</div>
              <div className="text-lg font-bold text-purple-600 mt-0.5">
                {totalMasterItems > 0 ? Math.round((itemsWithPhotoCount / totalMasterItems) * 100) : 0}%
              </div>
            </div>
            <div className="p-2 rounded-lg bg-purple-50 text-purple-600 border border-purple-100">
              <Sparkles className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Tab Switcher & Search Bar Header */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xs p-2.5 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Tab Buttons */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
          <button
            onClick={() => setActiveTabMode('gallery')}
            className={`px-3.5 py-2 text-xs md:text-sm font-bold rounded-lg transition flex items-center gap-2 cursor-pointer ${
              activeTabMode === 'gallery'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            <span>Katalog & Daftar Foto ({catalogPhotos.length})</span>
          </button>

          <button
            onClick={() => setActiveTabMode('upload')}
            className={`px-3.5 py-2 text-xs md:text-sm font-bold rounded-lg transition flex items-center gap-2 cursor-pointer ${
              activeTabMode === 'upload'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Area Upload Massal</span>
            {stagedFiles.length > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-extrabold bg-blue-600 text-white rounded-full">
                {stagedFiles.length}
              </span>
            )}
          </button>
        </div>

        {/* Prominent Search Input Column right beside Area Upload Massal */}
        <div className="relative flex-1 w-full min-w-[240px]">
          <Search className="w-5 h-5 text-blue-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari Kode Barang, Nama Barang, Group, atau Catatan Foto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-10 py-2.5 bg-slate-50 border-2 border-blue-200 focus:border-blue-600 focus:bg-white rounded-xl text-xs md:text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:ring-4 focus:ring-blue-100 transition shadow-2xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 bg-slate-200/80 rounded-full cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Action Controls: Download All ZIP & View Layout Toggle for Gallery */}
        {activeTabMode === 'gallery' && (
          <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
            {onSyncSupabase && (
              <button
                onClick={onSyncSupabase}
                className="px-3.5 py-2 text-xs md:text-sm font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl transition flex items-center gap-2 cursor-pointer shrink-0"
                title="SINKRONKAN: Muat ulang data dari database SQL Server & bersihkan cache lokal browser"
              >
                <RefreshCw className="w-4 h-4 text-blue-600" />
                <span>Sinkron Database &amp; Clear Cache</span>
              </button>
            )}

            <button
              onClick={handleDownloadAllPhotosZip}
              disabled={isDownloadingZip || catalogPhotos.length === 0}
              className="px-3.5 py-2 text-xs md:text-sm font-bold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
              title="Download seluruh foto katalog dalam file ZIP (Nama file = Item Code)"
            >
              {isDownloadingZip ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>Download All Foto Katalog (.ZIP)</span>
            </button>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setViewStyle('grid')}
                className={`p-2 rounded-lg transition cursor-pointer ${viewStyle === 'grid' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                title="Tampilan Kartu Galeri Grid"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewStyle('table')}
                className={`p-2 rounded-lg transition cursor-pointer ${viewStyle === 'table' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                title="Tampilan Tabel Rinci"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Global Notice Alert Banner */}
      {uploadNotice && (
        <div className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 transition ${
          uploadNotice.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
          uploadNotice.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
          'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <div className="flex items-center gap-2 font-medium">
            {uploadNotice.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
            {uploadNotice.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            {uploadNotice.type === 'info' && <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />}
            <span>{uploadNotice.text}</span>
          </div>
          <button onClick={() => setUploadNotice(null)} className="p-1 hover:bg-black/5 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* MODE 1: BULK UPLOAD STAGING AREA */}
      {activeTabMode === 'upload' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-4">
          
          {/* Sub-tab Selection: File Upload vs Google Drive Link vs Bulk Link */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
            <button
              onClick={() => setUploadSourceType('file')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer ${
                uploadSourceType === 'file'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Upload className="w-4 h-4" />
              <span>Upload File (HP / Laptop)</span>
            </button>

            <button
              onClick={() => setUploadSourceType('gdrive_single')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer ${
                uploadSourceType === 'gdrive_single'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Link className="w-4 h-4" />
              <span>Input 1 Link GDrive</span>
            </button>

            <button
              onClick={() => setUploadSourceType('gdrive_bulk')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer ${
                uploadSourceType === 'gdrive_bulk'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
              <span>✨ Input Link Massal / Paste Excel</span>
            </button>
          </div>

          {/* Option A: Dropzone Box for Local File Upload */}
          {uploadSourceType === 'file' && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
              }}
              className="border-2 border-dashed border-blue-300 hover:border-blue-500 bg-blue-50/40 hover:bg-blue-50 p-6 rounded-xl text-center cursor-pointer transition flex flex-col items-center justify-center gap-2"
            >
              <div className="p-3 bg-blue-100 text-blue-600 rounded-full border border-blue-200">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <span className="font-bold text-sm text-slate-800 block">
                  Klik atau Drag & Drop Foto Barang di Sini
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">
                  Mendukung upload massal puluhan foto sekaligus (JPG, PNG, WEBP). Foto akan otomatis dikompresi & dipasangkan dengan Kode Barang.
                </span>
              </div>
              <button className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold shadow-2xs hover:bg-blue-700 transition">
                Pilih File Foto Massal
              </button>
            </div>
          )}

          {/* Option B: Single Google Drive Link / Image URL Input Form */}
          {uploadSourceType === 'gdrive_single' && (
            <div className="bg-slate-50/80 p-4 rounded-2xl border border-blue-200/80 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl border border-blue-200 shrink-0 mt-0.5">
                  <Link className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-slate-900">Input Foto dari Link Google Drive / URL Gambar</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Aplikasi ini mendukung link shareable Google Drive (seperti <code className="bg-slate-200 px-1 py-0.5 rounded text-[11px] font-mono">https://drive.google.com/file/d/.../view</code>). Link secara otomatis dikonversi menjadi gambar resolusi tinggi tanpa membebani penyimpanan perangkat.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Kode Barang (Pilih Master Item / Ketik) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    list="gdrive-master-item-list"
                    value={gdriveItemCode}
                    onChange={(e) => setGdriveItemCode(e.target.value.toUpperCase())}
                    placeholder="Ketik / Copas Kode Barang..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-blue-500"
                  />
                  <datalist id="gdrive-master-item-list">
                    {masterItems.map(m => (
                      <option key={m.itemCode} value={m.itemCode}>{m.itemName} ({m.groupName})</option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Catatan Foto (Opsional)
                  </label>
                  <input
                    type="text"
                    value={gdriveNotes}
                    onChange={(e) => setGdriveNotes(e.target.value)}
                    placeholder="Contoh: Foto Tampak Depan..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Paste Link Google Drive atau Direct Image URL <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={gdriveUrl}
                    onChange={(e) => setGdriveUrl(e.target.value)}
                    placeholder="Paste link di sini (Contoh: https://drive.google.com/file/d/1ABCXYZ/view?usp=sharing)..."
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 pr-10"
                  />
                  {gdriveUrl && (
                    <button
                      onClick={() => setGdriveUrl('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-lg"
                      title="Clear link"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Live Image Preview from Google Drive Link */}
              {gdriveUrl.trim() && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                  <div className="text-xs font-bold text-slate-700 flex flex-wrap items-center justify-between gap-1">
                    <span>Preview Foto Google Drive:</span>
                    <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 truncate max-w-xs">
                      CDN URL: {convertGoogleDriveUrl(gdriveUrl)}
                    </span>
                  </div>
                  <div className="h-44 bg-slate-100 rounded-xl overflow-hidden flex items-center justify-center border border-slate-200 relative p-1">
                    <img
                      src={convertGoogleDriveUrl(gdriveUrl)}
                      alt="Google Drive Preview"
                      className="object-contain h-full w-full rounded-lg"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                        const parent = (e.target as HTMLElement).parentElement;
                        if (parent && !parent.querySelector('.gdrive-error-msg')) {
                          const errDiv = document.createElement('div');
                          errDiv.className = 'gdrive-error-msg p-4 text-center text-xs text-rose-600 space-y-1';
                          errDiv.innerHTML = '<strong>Gagal memuat gambar dari Google Drive.</strong><br/>Mohon pastikan akses file di Google Drive sudah disetting ke <em>"Siapa saja yang memiliki link" (Anyone with the link)</em>.';
                          parent.appendChild(errDiv);
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="text-[11px] text-amber-800 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                  <span><strong>Panduan Google Drive:</strong> Di Google Drive &rarr; Klik <strong>Share / Bagikan</strong> &rarr; Ubah Akses ke <strong>"Siapa saja yang memiliki link"</strong>.</span>
                </div>

                <button
                  onClick={handleAddGdriveLinkToStaging}
                  disabled={!gdriveUrl.trim() || !gdriveItemCode.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah Link Ke Staging</span>
                </button>
              </div>
            </div>
          )}

          {/* Option C: Bulk Google Drive Links & Excel Copy-Paste Input Form */}
          {uploadSourceType === 'gdrive_bulk' && (
            <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-200 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-emerald-100 text-emerald-800 rounded-xl border border-emerald-200 shrink-0 mt-0.5">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-slate-900">Input Link Massal Banyak Foto Sekaligus / Paste dari Excel</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Anda tidak perlu memasukkan link 1 per 1! Anda dapat menempelkan (paste) puluhan baris link Google Drive sekaligus, atau menyalin (copy) 2 kolom langsung dari Excel/Google Sheets (<code className="bg-emerald-100/80 px-1 py-0.5 rounded font-mono text-[11px]">Kode Barang</code> &amp; <code className="bg-emerald-100/80 px-1 py-0.5 rounded font-mono text-[11px]">Link Google Drive</code>).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Default Kode Barang (Digunakan jika baris link tidak ada kode)
                  </label>
                  <input
                    type="text"
                    value={defaultBulkItemCode}
                    onChange={(e) => setDefaultBulkItemCode(e.target.value.toUpperCase())}
                    placeholder="Opsional: Misal ABC241000010..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Default Catatan Foto
                  </label>
                  <input
                    type="text"
                    value={defaultBulkNotes}
                    onChange={(e) => setDefaultBulkNotes(e.target.value)}
                    placeholder="Misal: Foto Link Massal GDrive..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-800">
                    Kotak Input Data Massal (Paste Baris / Excel di Sini): <span className="text-rose-500">*</span>
                  </label>
                  <button
                    onClick={() => {
                      const sampleText = `ABC241000010\thttps://drive.google.com/file/d/1ABCXYZ_SAMPLE/view
ABC251100021\thttps://drive.google.com/file/d/2DEFUVW_SAMPLE/view
ABC251100022\thttps://drive.google.com/file/d/3GHIJKL_SAMPLE/view`;
                      setBulkGdriveText(sampleText);
                    }}
                    className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold underline cursor-pointer"
                  >
                    + Isi Contoh Format Excel
                  </button>
                </div>

                <textarea
                  rows={6}
                  value={bulkGdriveText}
                  onChange={(e) => setBulkGdriveText(e.target.value)}
                  placeholder={`Tempel/Paste baris data atau link di sini.

Format 1 (Hasil Copy 2 Kolom dari Excel / Google Sheet):
ABC241000010\thttps://drive.google.com/file/d/1ABCXYZ/view
ABC251100021\thttps://drive.google.com/file/d/2DEFUVW/view

Format 2 (Banyak Link Google Drive Saja):
https://drive.google.com/file/d/1ABCXYZ/view?usp=sharing
https://drive.google.com/file/d/2DEFUVW/view?usp=sharing`}
                  className="w-full p-3 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 leading-relaxed shadow-2xs"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="text-[11px] text-slate-600 bg-white p-2.5 rounded-xl border border-emerald-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Sistem akan mendeteksi Kode Barang &amp; Link secara otomatis dari setiap baris teks.</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {bulkGdriveText && (
                    <button
                      onClick={() => setBulkGdriveText('')}
                      className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={handleProcessBulkGdriveLinks}
                    disabled={!bulkGdriveText.trim()}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Proses &amp; Masukkan Ke Staging Massal</span>
                  </button>
                </div>
              </div>

              {/* Step-by-Step Guide Box for Google Drive Bulk Link Extraction */}
              <div className="bg-white p-3.5 rounded-xl border border-emerald-200 space-y-2 mt-2">
                <h5 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <span>Cara Dapatkan Banyak Link Sekaligus dari Google Drive &amp; Excel:</span>
                </h5>
                <ol className="text-xs text-slate-700 space-y-1.5 list-decimal pl-4 leading-relaxed">
                  <li>
                    <strong>Metode Excel / Google Sheet (Paling Praktis):</strong> Buka tabel data barang Anda di Excel. Copy kolom <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">Kode Barang</code> dan kolom <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">Link Google Drive</code>, lalu <strong>Paste</strong> langsung ke kotak di atas.
                  </li>
                  <li>
                    <strong>Metode Share Banyak Link Google Drive:</strong> Di Google Drive, pilih/blok semua file foto yang ingin di-upload (seperti pada screenshot Anda). Klik tombol <strong>Share / Bagikan</strong> (ikon rantai/orang di toolbar atas Google Drive) &rarr; Ubah Akses ke <strong>"Siapa saja yang memiliki link" (Anyone with the link)</strong>.
                  </li>
                  <li>
                    Copy link file tersebut dan Paste di kotak di atas. Kode barang akan dicocokkan otomatis jika terdapat pada nama file atau daftar barang Anda.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {/* Staging Control Bar */}
          {stagedFiles.length > 0 && (
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="font-bold text-xs text-slate-800 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-blue-600" />
                  <span>Daftar Staging ({stagedFiles.length} Foto Siap Di-upload)</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStagedFiles([])}
                    className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-md font-medium transition"
                  >
                    Kosongkan Staging
                  </button>

                  <button
                    onClick={handleSaveAllStaged}
                    disabled={isSavingBatch}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-md shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isSavingBatch ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Menyimpan Ke Katalog...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Simpan Semua Ke Katalog ({stagedFiles.length})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Batch Assignment & Quick Auto Tools Bar */}
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span>Fitur Otomatis Kode Barang Staging:</span>
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleAutoFetchGDriveNames()}
                      disabled={isFetchingGDriveNames}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Sistem akan otomatis mengambil nama file asli foto dari link Google Drive"
                    >
                      {isFetchingGDriveNames ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                          <span>Deteksi Nama File GDrive ({gdriveFetchProgress.current}/{gdriveFetchProgress.total})...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                          <span>⚡ Ambil Nama File dari GDrive (Auto Fetch)</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setShowPasteCodesBox(!showPasteCodesBox)}
                      className={`px-3 py-1.5 font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer border ${
                        showPasteCodesBox 
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-800'
                      }`}
                      title="Tempelkan daftar kode barang dari teks / Excel berurutan ke staging"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>📋 Paste Daftar Kode Barang (Berurutan)</span>
                    </button>

                    <button
                      onClick={handleSequentialMatchMasterItems}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      title="Memasangkan Kode Barang berurutan dari Master Items ke foto staging yang kosong"
                    >
                      <Link className="w-3.5 h-3.5 text-emerald-600" />
                      <span>🔗 Pasangkan Urutan dari Master Items</span>
                    </button>
                  </div>
                </div>

                {/* Sequential Paste Box Panel */}
                {showPasteCodesBox && (
                  <div className="bg-purple-50/80 border border-purple-200 p-3 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-900 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-purple-600" />
                        <span>Tempel / Paste List Kode Barang (1 Kode / Nama File Per Baris):</span>
                      </span>
                      <button
                        onClick={() => setShowPasteCodesBox(false)}
                        className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      value={pasteCodesText}
                      onChange={(e) => setPasteCodesText(e.target.value)}
                      placeholder={`Tempelkan daftar nama file/kode barang di sini (1 per baris).
Contoh:
ABC241000010
ABC251100021
ABC251100022
ABC251100023`}
                      className="w-full p-2.5 bg-white border border-purple-300 rounded-lg text-xs font-mono text-slate-800 focus:ring-2 focus:ring-purple-500"
                    />
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-600">
                        Setiap baris kode akan dipasangkan ke foto staging #1, #2, #3... secara berurutan dan otomatis dicocokkan dengan Master Item.
                      </span>
                      <button
                        onClick={handleApplyPastedCodes}
                        disabled={!pasteCodesText.trim()}
                        className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        Terapkan ke Staging
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col md:flex-row items-center gap-2">
                  <span className="font-semibold text-slate-700 shrink-0">Terapkan Sekaligus ke Semua Staging:</span>
                  
                  <div className="relative flex-1 max-w-xs w-full">
                    <input
                      type="text"
                      list="batch-master-item-list"
                      value={batchAssignItemCode}
                      onChange={(e) => setBatchAssignItemCode(e.target.value.toUpperCase())}
                      placeholder="Copas / Ketik Kode Barang..."
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-blue-500"
                    />
                    <datalist id="batch-master-item-list">
                      {masterItems.map(m => (
                        <option key={m.itemCode} value={m.itemCode}>{m.itemName} ({m.groupName})</option>
                      ))}
                    </datalist>
                  </div>

                  <input
                    type="text"
                    placeholder="Catatan foto (opsional)..."
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs flex-1"
                  />

                  <button
                    onClick={handleApplyBatchItemCode}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition shrink-0 cursor-pointer"
                  >
                    Terapkan Ke Semua
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Staged Items Grid */}
          {stagedFiles.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {stagedFiles.map((stagedItem, idx) => {
                const selectedMaster = masterMap.get(stagedItem.itemCode);

                return (
                  <div key={stagedItem.id} className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
                    {/* Thumbnail Header */}
                    <div className="relative h-40 bg-slate-100 flex items-center justify-center overflow-hidden border-b border-slate-100">
                      <img
                        src={stagedItem.previewUrl}
                        alt="Preview"
                        className="object-cover w-full h-full hover:scale-105 transition duration-300"
                      />

                      <div className="absolute top-2 left-2 flex items-center gap-1">
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-900/80 text-white rounded backdrop-blur-xs">
                          #{idx + 1}
                        </span>
                        {stagedItem.autoMatched && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-600 text-white rounded flex items-center gap-1 shadow-xs">
                            <Sparkles className="w-3 h-3" /> Auto Match
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => handleRemoveStaged(stagedItem.id)}
                        className="absolute top-2 right-2 p-1 bg-rose-600 text-white rounded-full hover:bg-rose-700 shadow-xs transition"
                        title="Hapus dari staging"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Form Controls */}
                    <div className="p-2.5 space-y-2 flex-1 flex flex-col justify-between text-xs">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Kode Barang (Bisa Copas / Ketik)
                        </label>
                        <input
                          type="text"
                          list={`datalist_${stagedItem.id}`}
                          value={stagedItem.itemCode}
                          onChange={(e) => {
                            const newCode = e.target.value.toUpperCase().trim();
                            const m = masterMap.get(newCode);
                            setStagedFiles(prev => prev.map(s => s.id === stagedItem.id ? {
                              ...s,
                              itemCode: newCode,
                              itemName: m ? m.itemName : (s.itemName || newCode),
                              groupName: m ? m.groupName : s.groupName
                            } : s));
                          }}
                          placeholder="Copas / Ketik Kode..."
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-blue-500"
                        />
                        <datalist id={`datalist_${stagedItem.id}`}>
                          {masterItems.map(m => (
                            <option key={m.itemCode} value={m.itemCode}>{m.itemName}</option>
                          ))}
                        </datalist>
                      </div>

                      {selectedMaster && (
                        <div className="bg-slate-50 p-1.5 rounded border border-slate-200 text-[11px] space-y-0.5">
                          <div className="font-semibold text-slate-800 truncate">{selectedMaster.itemName}</div>
                          <div className="text-[10px] text-slate-500">Group: <strong className="text-slate-700">{selectedMaster.groupName}</strong></div>
                        </div>
                      )}

                      <div>
                        <input
                          type="text"
                          placeholder="Catatan foto..."
                          value={stagedItem.notes}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStagedFiles(prev => prev.map(s => s.id === stagedItem.id ? { ...s, notes: val } : s));
                          }}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODE 2: GALLERY CATALOG VIEW & FILTER */}
      {activeTabMode === 'gallery' && (
        <div className="space-y-4">
          
          {/* Filter & Sort Controls Bar */}
          <div className="bg-white p-3.5 rounded-2xl border-2 border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-sm">
            
            {/* Filter Status Buttons */}
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              <button
                onClick={() => setPhotoFilterStatus('ALL')}
                className={`px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-bold transition ${
                  photoFilterStatus === 'ALL'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Semua ({masterItems.length})
              </button>

              <button
                onClick={() => setPhotoFilterStatus('HAS_PHOTO')}
                className={`px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 ${
                  photoFilterStatus === 'HAS_PHOTO'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Ada Foto ({itemsWithPhotoCount})</span>
              </button>

              <button
                onClick={() => setPhotoFilterStatus('NO_PHOTO')}
                className={`px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 ${
                  photoFilterStatus === 'NO_PHOTO'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <AlertCircle className="w-4 h-4" />
                <span>Belum Ada Foto ({itemsWithoutPhotoCount})</span>
              </button>
            </div>

            {/* Group Dropdown Filter */}
            {availableGroups.length > 0 && (
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs md:text-sm font-bold text-slate-800 shrink-0 w-full md:w-auto cursor-pointer"
              >
                <option value="">-- Semua Group --</option>
                {availableGroups.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            )}

            {/* Filter Tahun CreatedDate */}
            <div className="flex items-center gap-1.5 shrink-0 w-full md:w-auto">
              <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs md:text-sm font-bold text-slate-800 shrink-0 w-full md:w-auto cursor-pointer"
              >
                <option value="">-- Semua Tahun (CreateDate) --</option>
                {availableYears.map(yr => (
                  <option key={yr} value={yr}>Tahun {yr}</option>
                ))}
              </select>
            </div>

            {/* Sort Order Dropdown */}
            <div className="flex items-center gap-1.5 shrink-0 w-full md:w-auto">
              <ArrowUpDown className="w-4 h-4 text-slate-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2.5 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl text-xs md:text-sm font-extrabold shrink-0 w-full md:w-auto"
              >
                <option value="qty_desc">Urutkan: Qty Terbanyak → Sedikit</option>
                <option value="qty_asc">Urutkan: Qty Sedikit → Terbanyak</option>
                <option value="code_asc">Urutkan: Kode Barang (A-Z)</option>
                <option value="name_asc">Urutkan: Nama Barang (A-Z)</option>
              </select>
            </div>
          </div>

          {copiedCodeNotice && (
            <div className="p-2.5 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Kode Barang <strong>{copiedCodeNotice}</strong> berhasil di-copas ke clipboard!</span>
            </div>
          )}

          {/* GRID VIEW */}
          {viewStyle === 'grid' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {paginatedItems.map(item => {
                const photo = photoMapByItemCode.get(item.itemCode);
                const stats = stockStatsMap.get(item.itemCode.trim().toUpperCase()) || {
                  totalMasuk: 0,
                  totalKeluar: 0,
                  sisaStock: 0,
                  sisaNilaiBeli: 0,
                  sisaNilaiJual: 0,
                  doOpenCount: 0,
                  doOpenQty: 0,
                  doOpenNilaiBeli: 0,
                  doOpenNilaiJual: 0,
                  qtyLepasan: 0,
                  lepasanNilaiBeli: 0,
                  lepasanNilaiJual: 0
                };

                return (
                  <div
                    key={item.itemCode}
                    className={`bg-white rounded-xl border transition duration-200 shadow-2xs overflow-hidden flex flex-col justify-between ${
                      photo ? 'border-slate-200 hover:border-blue-400 hover:shadow-md' : 'border-dashed border-amber-300 bg-amber-50/20'
                    }`}
                  >
                    {/* Photo Container */}
                    <div className="relative h-48 bg-slate-100 flex items-center justify-center overflow-hidden group">
                      {photo ? (
                        <>
                          <img
                            src={photo.photoUrl}
                            alt={item.itemName}
                            loading="lazy"
                            className="object-cover w-full h-full group-hover:scale-105 transition duration-300 cursor-pointer"
                            onClick={() => setSelectedLightboxPhoto(photo)}
                          />

                          <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition duration-200 flex items-center justify-center gap-2 backdrop-blur-2xs">
                            <button
                              onClick={() => setSelectedLightboxPhoto(photo)}
                              className="px-3 py-1.5 bg-white/90 hover:bg-white text-slate-900 font-bold rounded-lg text-xs shadow-md flex items-center gap-1.5 transition"
                            >
                              <Eye className="w-3.5 h-3.5 text-blue-600" />
                              <span>Lihat Detail</span>
                            </button>

                            {(currentUser?.role === 'Admin' || currentUser?.role === 'Audit') && (
                              <button
                                onClick={() => {
                                  if (confirm(`Apakah Anda yakin ingin menghapus foto untuk Kode Barang '${item.itemCode}'?`)) {
                                    onDeleteCatalogPhoto(photo.id);
                                  }
                                }}
                                className="p-1.5 bg-rose-600/90 hover:bg-rose-600 text-white rounded-lg shadow-md transition cursor-pointer"
                                title="Hapus foto dari katalog"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-bold bg-emerald-600 text-white rounded-full shadow-xs flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Ada Foto
                          </span>
                        </>
                      ) : (
                        <div className="text-center p-4 space-y-2">
                          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
                            <Camera className="w-6 h-6" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-amber-900 block">Belum Ada Foto</span>
                            <span className="text-[10px] text-slate-500 block">Klik tombol di bawah untuk upload</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Content Details */}
                    <div className="p-3 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1">
                            <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded">
                              {item.itemCode}
                            </span>
                            <button
                              onClick={() => handleCopyCode(item.itemCode)}
                              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                              title="Copas Kode Barang"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {item.groupName}
                          </span>
                        </div>

                        <h3 className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug">
                          {item.itemName}
                        </h3>

                        {photo?.notes && (
                          <p className="text-[11px] text-slate-500 mt-1 italic line-clamp-1">
                            "{photo.notes}"
                          </p>
                        )}

                        {/* DETAIL CATATAN STOCK */}
                        <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1 text-[11px]">
                          {/* Sisa Stock */}
                          <div className="flex items-center justify-between bg-emerald-50/70 px-2 py-1 rounded border border-emerald-100">
                            <span className="font-semibold text-emerald-900">Sisa Stock:</span>
                            <div className="text-right font-mono">
                              <span className="font-bold text-emerald-700">{stats.sisaStock.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                              <span className="text-[10px] text-slate-500 block">Beli: Rp {stats.sisaNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                              <span className="text-[10px] text-emerald-600 block">Jual: Rp {stats.sisaNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                            </div>
                          </div>

                          {/* DO OPEN */}
                          <div className="flex items-center justify-between bg-blue-50/70 px-2 py-1 rounded border border-blue-100">
                            <span className="font-semibold text-blue-900">DO OPEN ({stats.doOpenCount}):</span>
                            <div className="text-right font-mono">
                              <span className="font-bold text-blue-700">{stats.doOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                              <span className="text-[10px] text-slate-500 block">Beli: Rp {stats.doOpenNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                              <span className="text-[10px] text-blue-600 block">Jual: Rp {stats.doOpenNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                            </div>
                          </div>

                          {/* Qty Lepasan */}
                          <div className="flex items-center justify-between bg-purple-50/70 px-2 py-1 rounded border border-purple-100">
                            <span className="font-semibold text-purple-900">Qty Lepasan:</span>
                            <div className="text-right font-mono">
                              <span className="font-bold text-purple-700">{stats.qtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                              <span className="text-[10px] text-slate-500 block">Beli: Rp {stats.lepasanNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                              <span className="text-[10px] text-purple-600 block">Jual: Rp {stats.lepasanNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                            </div>
                          </div>

                          {/* Create Code / Created Date */}
                          <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 pt-0.5">
                            <span>Created Date:</span>
                            <span className="font-mono font-semibold text-slate-600">{item.createdDate || item.createdAt?.slice(0, 10) || '-'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                        <button
                          onClick={() => handleOpenRequestModal(item)}
                          className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition shadow-2xs"
                        >
                          <FilePlus className="w-3.5 h-3.5" />
                          <span>Request DO OPEN</span>
                        </button>

                        {!photo && (
                          <button
                            onClick={() => {
                              setBatchAssignItemCode(item.itemCode);
                              setActiveTabMode('upload');
                              fileInputRef.current?.click();
                            }}
                            className="w-full py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-semibold rounded-lg text-[11px] flex items-center justify-center gap-1 transition"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Upload Foto Item</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TABLE VIEW */}
          {viewStyle === 'table' && (
            <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-slate-100 border-b border-slate-800 text-xs md:text-sm uppercase tracking-wider font-extrabold">
                      <th className="p-4 font-extrabold w-20 text-center">Foto</th>
                      <th className="p-4 font-extrabold">Kode Barang</th>
                      <th className="p-4 font-extrabold">Nama Barang</th>
                      <th className="p-4 font-extrabold">Group</th>
                      <th className="p-4 font-extrabold text-right">Sisa Stock</th>
                      <th className="p-4 font-extrabold text-right">DO OPEN</th>
                      <th className="p-4 font-extrabold text-right">Qty Lepasan</th>
                      <th className="p-4 font-extrabold">Created Date</th>
                      <th className="p-4 font-extrabold text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {paginatedItems.map((item, idx) => {
                      const photo = photoMapByItemCode.get(item.itemCode);
                      const stats = stockStatsMap.get(item.itemCode.trim().toUpperCase()) || {
                        totalMasuk: 0,
                        totalKeluar: 0,
                        sisaStock: 0,
                        sisaNilaiBeli: 0,
                        sisaNilaiJual: 0,
                        doOpenCount: 0,
                        doOpenQty: 0,
                        doOpenNilaiBeli: 0,
                        doOpenNilaiJual: 0,
                        qtyLepasan: 0,
                        lepasanNilaiBeli: 0,
                        lepasanNilaiJual: 0
                      };

                      return (
                        <tr key={item.itemCode} className={`hover:bg-blue-50/60 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                          <td className="p-3.5 text-center">
                            {photo ? (
                              <img
                                src={photo.photoUrl}
                                alt={item.itemName}
                                loading="lazy"
                                onClick={() => setSelectedLightboxPhoto(photo)}
                                className="w-14 h-14 md:w-16 md:h-16 object-cover rounded-xl border-2 border-slate-200 mx-auto cursor-pointer hover:scale-105 transition shadow-2xs"
                              />
                            ) : (
                              <div className="w-14 h-14 md:w-16 md:h-16 rounded-xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center text-amber-500 mx-auto shadow-2xs">
                                <Camera className="w-6 h-6" />
                              </div>
                            )}
                          </td>

                          <td className="p-4 font-mono font-extrabold text-blue-700 text-sm md:text-base">
                            <div className="flex items-center gap-1.5">
                              <span>{item.itemCode}</span>
                              <button
                                onClick={() => handleCopyCode(item.itemCode)}
                                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                title="Copas Kode Barang"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                          <td className="p-4 font-bold text-slate-900 text-xs md:text-sm leading-snug">{item.itemName}</td>
                          <td className="p-4 text-xs md:text-sm font-semibold text-slate-600">
                            <span className="bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">{item.groupName}</span>
                          </td>

                          {/* Sisa Stock */}
                          <td className="p-4 text-right font-mono">
                            <span className="font-extrabold text-emerald-700 text-sm md:text-base block">{stats.sisaStock.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                            <span className="text-xs text-slate-500 font-medium block">Beli: Rp {stats.sisaNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                            <span className="text-xs text-emerald-600 font-medium">Jual: Rp {stats.sisaNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                          </td>

                          {/* DO OPEN */}
                          <td className="p-4 text-right font-mono">
                            <span className="font-extrabold text-blue-700 text-sm md:text-base block">{stats.doOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                            <span className="text-xs text-slate-500 font-medium block">Beli: Rp {stats.doOpenNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                            <span className="text-xs text-blue-600 font-medium">Jual: Rp {stats.doOpenNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                          </td>

                          {/* Qty Lepasan */}
                          <td className="p-4 text-right font-mono">
                            <span className="font-extrabold text-purple-700 text-sm md:text-base block">{stats.qtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                            <span className="text-xs text-slate-500 font-medium block">Beli: Rp {stats.lepasanNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                            <span className="text-xs text-purple-600 font-medium">Jual: Rp {stats.lepasanNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                          </td>

                          {/* Created Date */}
                          <td className="p-4 font-mono font-bold text-slate-700 text-xs md:text-sm">
                            {item.createdDate || item.createdAt?.slice(0, 10) || '-'}
                          </td>

                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleOpenRequestModal(item)}
                                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs md:text-sm font-bold flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                              >
                                <FilePlus className="w-4 h-4" />
                                <span>Request DO</span>
                              </button>

                              {photo ? (
                                <button
                                  onClick={() => setSelectedLightboxPhoto(photo)}
                                  className="p-2 text-blue-600 hover:bg-blue-100 rounded-xl transition cursor-pointer"
                                  title="Lihat foto"
                                >
                                  <Eye className="w-5 h-5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setBatchAssignItemCode(item.itemCode);
                                    setActiveTabMode('upload');
                                    fileInputRef.current?.click();
                                  }}
                                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold transition cursor-pointer"
                                >
                                  Upload
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sortedFilteredItems.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 space-y-2">
              <Camera className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="font-semibold text-sm text-slate-800">Tidak ada item yang cocok dengan pencarian / filter.</p>
              <button
                onClick={() => { setSearchQuery(''); setSelectedGroup(''); setPhotoFilterStatus('ALL'); setSortBy('qty_desc'); }}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition"
              >
                Reset Filter
              </button>
            </div>
          )}

          {sortedFilteredItems.length > 0 && totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <span className="text-xs text-slate-500 font-medium">
                Menampilkan {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, sortedFilteredItems.length)} dari {sortedFilteredItems.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} item
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  ← Sebelumnya
                </button>
                <span className="text-xs font-mono font-semibold text-slate-600 px-2">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Selanjutnya →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* LIGHTBOX MODAL FULLSCREEN VIEW */}
      {selectedLightboxPhoto && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl text-white flex flex-col">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs font-mono font-bold bg-blue-600 text-white rounded">
                  {selectedLightboxPhoto.itemCode}
                </span>
                <span className="font-bold text-sm text-slate-100">
                  {selectedLightboxPhoto.itemName || selectedLightboxPhoto.itemCode}
                </span>
              </div>

              <button
                onClick={() => setSelectedLightboxPhoto(null)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Image Body */}
            <div className="bg-black/80 p-4 flex items-center justify-center max-h-[50vh] overflow-hidden">
              <img
                src={selectedLightboxPhoto.photoUrl}
                alt={selectedLightboxPhoto.itemName}
                className="max-h-[45vh] max-w-full object-contain rounded-lg shadow-lg"
              />
            </div>

            {/* Modal Footer & Details */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                {(() => {
                  const itemObj = masterMap.get(selectedLightboxPhoto.itemCode);
                  const stats = stockStatsMap.get(selectedLightboxPhoto.itemCode.trim().toUpperCase()) || {
                    sisaStock: 0, sisaNilaiBeli: 0, sisaNilaiJual: 0, doOpenCount: 0, doOpenQty: 0, doOpenNilaiBeli: 0, doOpenNilaiJual: 0, qtyLepasan: 0, lepasanNilaiBeli: 0, lepasanNilaiJual: 0
                  };

                  return (
                    <>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Sisa Stock</span>
                        <span className="font-bold text-emerald-400">{stats.sisaStock.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                        <span className="text-[10px] text-slate-500 block">Beli: Rp {stats.sisaNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                        <span className="text-[10px] text-emerald-500 block">Jual: Rp {stats.sisaNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">DO OPEN ({stats.doOpenCount})</span>
                        <span className="font-bold text-blue-400">{stats.doOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                        <span className="text-[10px] text-slate-500 block">Beli: Rp {stats.doOpenNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                        <span className="text-[10px] text-blue-500 block">Jual: Rp {stats.doOpenNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Qty Lepasan</span>
                        <span className="font-bold text-purple-400">{stats.qtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                        <span className="text-[10px] text-slate-500 block">Beli: Rp {stats.lepasanNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                        <span className="text-[10px] text-purple-500 block">Jual: Rp {stats.lepasanNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Created Date</span>
                        <span className="font-mono text-slate-200">{itemObj?.createdDate || selectedLightboxPhoto.createdAt?.slice(0, 10) || '-'}</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {selectedLightboxPhoto.notes && (
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-xs">
                  <span className="text-slate-400 font-bold block text-[10px] uppercase mb-0.5">Catatan Foto</span>
                  <p className="text-slate-300 italic">"{selectedLightboxPhoto.notes}"</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 gap-2">
                <a
                  href={selectedLightboxPhoto.photoUrl}
                  download={`${selectedLightboxPhoto.itemCode}.jpg`}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition border border-slate-700"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Foto</span>
                </a>

                {(() => {
                  const itemObj = masterMap.get(selectedLightboxPhoto.itemCode);
                  if (!itemObj) return null;

                  return (
                    <button
                      onClick={() => {
                        setSelectedLightboxPhoto(null);
                        handleOpenRequestModal(itemObj);
                      }}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition shadow-sm"
                    >
                      <FilePlus className="w-4 h-4" />
                      <span>Request DO OPEN dari Foto Ini</span>
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REQUEST DO OPEN DARI KATALOG */}
      {requestModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200 text-slate-800 flex flex-col">
            
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-600 rounded-xl">
                  <FilePlus className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Request DO OPEN Dari Katalog</h3>
                  <p className="text-[11px] text-slate-300">Pilih & ajukan pengiriman berdasarkan foto barang</p>
                </div>
              </div>

              <button
                onClick={() => setRequestModalItem(null)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitRequestDoOpen} className="p-4 space-y-3.5 text-xs">
              
              {/* Item Summary Box */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex gap-3 items-center">
                {requestModalItem.photo ? (
                  <img
                    src={requestModalItem.photo.photoUrl}
                    alt={requestModalItem.item.itemName}
                    className="w-16 h-16 object-cover rounded-lg border border-slate-200 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500 shrink-0">
                    <Camera className="w-6 h-6" />
                  </div>
                )}

                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-100 text-blue-800 rounded">
                      {requestModalItem.item.itemCode}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-500">
                      {requestModalItem.item.groupName}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 truncate text-xs">{requestModalItem.item.itemName}</h4>
                  
                  {(() => {
                    const stats = stockStatsMap.get(requestModalItem.item.itemCode.trim().toUpperCase()) || { sisaStock: 0, doOpenQty: 0, qtyLepasan: 0 };
                    return (
                      <div className="text-[10px] text-slate-600 flex gap-3 pt-1">
                        <span>Sisa: <strong className="text-emerald-700">{stats.sisaStock} Pcs</strong></span>
                        <span>DO OPEN: <strong className="text-blue-700">{stats.doOpenQty} Pcs</strong></span>
                        <span>Lepasan: <strong className="text-purple-700">{stats.qtyLepasan} Pcs</strong></span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {reqNotice && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{reqNotice}</span>
                </div>
              )}

              {/* Form Fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">No. DO OPEN / Doc No *</label>
                  <input
                    type="text"
                    required
                    value={reqDocNo}
                    onChange={(e) => setReqDocNo(e.target.value)}
                    placeholder="Contoh: REQ-DO-1001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Qty Request (Pcs) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={reqQty}
                    onChange={(e) => setReqQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Request / Shipping</label>
                  <input
                    type="date"
                    value={reqDate}
                    onChange={(e) => setReqDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Lokasi Asal</label>
                  <input
                    type="text"
                    value={reqFromLoc}
                    onChange={(e) => setReqFromLoc(e.target.value)}
                    placeholder="GUDANG UTAMA"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lokasi Tujuan</label>
                <input
                  type="text"
                  value={reqToLoc}
                  onChange={(e) => setReqToLoc(e.target.value)}
                  placeholder="LOGISTIK / PROYEK A"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keterangan / Remark</label>
                <input
                  type="text"
                  value={reqRemark}
                  onChange={(e) => setReqRemark(e.target.value)}
                  placeholder="Instruksi khusus pengiriman..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRequestModalItem(null)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReq}
                  className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition shadow-md flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmittingReq ? 'Mengirim Request...' : 'Kirim Request DO OPEN'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Progress Modal Overlay for ZIP Download */}
      {isDownloadingZip && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-100 text-emerald-700 rounded-2xl">
                <Download className="w-6 h-6 animate-bounce" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Mengunduh All Foto Katalog</h3>
                <p className="text-xs text-slate-500 font-medium">Setiap foto disimpan dengan nama Item Code</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="truncate pr-2">{zipProgress.stage}</span>
                <span className="font-mono text-emerald-700">{zipProgress.percent}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden p-0.5 border border-slate-200">
                <div 
                  className="bg-emerald-600 h-full rounded-full transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(0, zipProgress.percent))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono pt-1">
                <span>Proses: {zipProgress.current} dari {zipProgress.total} foto</span>
                <span>Format: .ZIP Archive</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200/80 text-[11px] text-emerald-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
              <span>Mohon tunggu sejenak, sistem sedang mengumpulkan & mengompres seluruh gambar ke file ZIP...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
