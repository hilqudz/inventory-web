import * as XLSX from 'xlsx';
import { MasterItem, TransactionRecord, DoOpenRecord } from '../types';

/**
 * Export array of objects to Excel file (.xlsx)
 */
export function exportToExcel<T extends Record<string, any>>(
  data: T[],
  filename: string,
  sheetName = 'Data'
) {
  if (!data || data.length === 0) {
    alert('Tidak ada data untuk diexport.');
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Auto-width for columns
  const max_widths = Object.keys(data[0]).map(key => {
    return {
      wch: Math.max(
        key.length + 3,
        ...data.map(row => (row[key] !== undefined && row[key] !== null ? String(row[key]).length + 2 : 5))
      )
    };
  });
  worksheet['!cols'] = max_widths;

  XLSX.writeFile(workbook, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export interface ExcelSheetConfig {
  sheetName: string;
  data: Record<string, any>[];
}

/**
 * Export multiple sheets to a single Excel workbook (.xlsx)
 */
export function exportMultiSheetExcel(
  sheets: ExcelSheetConfig[],
  filename: string
) {
  if (!sheets || sheets.length === 0) {
    alert('Tidak ada data untuk diexport.');
    return;
  }

  const workbook = XLSX.utils.book_new();

  sheets.forEach(s => {
    const sheetData = s.data && s.data.length > 0 ? s.data : [{ 'Info': 'Tidak ada data' }];
    const worksheet = XLSX.utils.json_to_sheet(sheetData);

    // Auto-width for columns
    const max_widths = Object.keys(sheetData[0]).map(key => {
      return {
        wch: Math.max(
          key.length + 3,
          ...sheetData.map(row => (row[key] !== undefined && row[key] !== null ? String(row[key]).length + 2 : 5))
        )
      };
    });
    worksheet['!cols'] = max_widths;

    // Excel sheet name max length is 31 chars
    const safeSheetName = s.sheetName.replace(/[\\/?*:[\]]/g, ' ').slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
  });

  XLSX.writeFile(workbook, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/**
 * Parse uploaded Excel file to JSON array (First Sheet)
 */
export function parseExcelFile<T>(file: File): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Parse as raw JSON rows
        const jsonData = XLSX.utils.sheet_to_json<T>(worksheet, { defval: '' });
        resolve(jsonData);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse all sheets in an uploaded Excel file
 */
export function parseExcelWorkbook(file: File): Promise<{
  sheetNames: string[];
  sheetsData: Record<string, any[]>;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetsData: Record<string, any[]> = {};

        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          sheetsData[sheetName] = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });
        });

        resolve({ sheetNames: workbook.SheetNames, sheetsData });
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Download sample templates with correct header format
 */
export function downloadExcelTemplate(type: 'master' | 'transaksi' | 'do_open' | 'container') {
  let sampleData: any[] = [];
  let filename = 'Template';

  if (type === 'master') {
    filename = 'Template_Master_Item';
    sampleData = [
      {
        'Item Code': 'ITM-001',
        'Item Name': 'Semen Tiga Roda 50kg',
        'Group Name': 'Bahan Bangunan',
        'Harga Jual': 75000,
        'Harga Beli': 65000,
        'CreateDate': '2026-01-15'
      },
      {
        'Item Code': 'ITM-002',
        'Item Name': 'Cat Dulux Putih 5L',
        'Group Name': 'Cat & Finishing',
        'Harga Jual': 185000,
        'Harga Beli': 160000,
        'CreateDate': '2026-02-20'
      }
    ];
  } else if (type === 'transaksi') {
    filename = 'Template_Transaksi';
    sampleData = [
      {
        PostingDate: new Date().toISOString().slice(0, 10),
        EntryName: 'Admin Gudang',
        DocumentNo: 'DOC-2026-001',
        ItemCode: 'ITM-001',
        Category: 'Bahan Bangunan',
        Remark: 'Penerimaan Stok Utama',
        Qty: 100,
        From: 'Supplier PT Jaya',
        To: 'Gudang Utama'
      },
      {
        PostingDate: new Date().toISOString().slice(0, 10),
        EntryName: 'Admin Gudang',
        DocumentNo: 'DOC-2026-002',
        ItemCode: 'ITM-002',
        Category: 'Cat & Finishing',
        Remark: 'Penerimaan Pabrik',
        Qty: 50,
        From: 'Supplier Dulux',
        To: 'Gudang A'
      }
    ];
  } else if (type === 'do_open') {
    filename = 'Template_DO_OPEN';
    sampleData = [
      {
        PostingDate: new Date().toISOString().slice(0, 10),
        'Area RM OPR': 'BELUM ADA AREA OPR',
        DocumentNo: 'DOIM-KB-GBCPP-927',
        'No DOSL': 'DOSL-KB-GBCPP-1248',
        ItemCode: 'MSB200400092',
        'Item Name': 'SPRAY BOTTLE',
        'Group Name': 'BOTOL SPRAY',
        'Status DO OPEN': 'DO SUDAH DI LOGISTIK',
        'Area SPV OPR': 'BELUM ADA AREA OPR',
        Qty: 960,
        'Nilai Jual (Rp)': 23904000,
        'Nilai Beli (Rp)': 3186384,
        From: 'GBCPP',
        To: 'OPCPP01',
        Keterangan: '-'
      },
      {
        PostingDate: new Date().toISOString().slice(0, 10),
        'Area RM OPR': 'BELUM ADA AREA OPR',
        DocumentNo: 'DOIM-KB-GBCPP-877',
        'No DOSL': 'DOSL-KB-GBCPP-1381',
        ItemCode: 'MSB200400092',
        'Item Name': 'SPRAY BOTTLE',
        'Group Name': 'BOTOL SPRAY',
        'Status DO OPEN': 'DO SUDAH DI LOGISTIK',
        'Area SPV OPR': 'BELUM ADA AREA OPR',
        Qty: 960,
        'Nilai Jual (Rp)': 23904000,
        'Nilai Beli (Rp)': 3186384,
        From: 'GBCPP',
        To: 'OPCPP01',
        Keterangan: '-'
      }
    ];
  } else if (type === 'container') {
    filename = 'Template_Status_Container';
    sampleData = [
      {
        'No Container': 'TCNU-1234567',
        'Category': 'IMPORT',
        'Tgl Tiba Di Priuk': new Date().toISOString().slice(0, 10),
        'Tgl Tiba Di Bintara': '',
        'Item Category Barang': 'SPAREPART',
        'Status Container': 'Container Masih OTW',
        'Total Qty': 500,
        'Total Cost': 15000000,
        'Total Price': 22500000,
        'Keterangan / Remark': 'Packing Kayu'
      },
      {
        'No Container': 'MSKU-8901234',
        'Category': 'LOKAL',
        'Tgl Tiba Di Priuk': new Date().toISOString().slice(0, 10),
        'Tgl Tiba Di Bintara': new Date().toISOString().slice(0, 10),
        'Item Category Barang': 'AKSESORIS',
        'Status Container': 'Barang Sudah Tiba di Bintara',
        'Total Qty': 1200,
        'Total Cost': 36000000,
        'Total Price': 50000000,
        'Keterangan / Remark': 'Lengkap'
      }
    ];
  }

  exportToExcel(sampleData, filename, 'Template');
}

/**
 * Helper to normalize any date value from Excel (JS Date, Excel Serial Number, or Date string)
 * into YYYY-MM-DD local format without UTC timezone rollback bug.
 */
export function normalizeExcelDate(rawVal: any): string {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 1. If it's a JavaScript Date object (e.g. parsed by SheetJS cellDates)
  if (rawVal instanceof Date) {
    if (isNaN(rawVal.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }
    // SheetJS creates cell dates in UTC (e.g. 2026-07-25T00:00:00.000Z).
    // Using UTC date components avoids timezone offset rollback (e.g., UTC-7 shifting July 25 to July 24).
    const year = rawVal.getUTCFullYear();
    const month = String(rawVal.getUTCMonth() + 1).padStart(2, '0');
    const day = String(rawVal.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 2. If it's an Excel numeric date serial (e.g. 46228 for 25 July 2026)
  if (typeof rawVal === 'number' && rawVal > 1000) {
    try {
      const parsed = XLSX.SSF.parse_date_code(rawVal);
      if (parsed) {
        const year = parsed.y;
        const month = String(parsed.m).padStart(2, '0');
        const day = String(parsed.d).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch {
      // ignore & fallback
    }
  }

  const str = String(rawVal).trim();
  if (!str) return new Date().toISOString().slice(0, 10);

  // 3. String in YYYY-MM-DD, YYYY/MM/DD, or YYYY.MM.DD
  if (/^\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2}/.test(str)) {
    const parts = str.split(/[\/\.-]/);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].slice(0, 2).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 4. String with text Month Name (e.g. "7-Aug-24", "7-Aug-2024", "7 Agustus 2024", "07-Ags-2024", "Aug 7, 2024")
  const MONTH_MAP: Record<string, string> = {
    jan: '01', januari: '01', january: '01',
    feb: '02', februari: '02', february: '02',
    mar: '03', maret: '03', march: '03',
    apr: '04', april: '04',
    may: '05', mei: '05',
    jun: '06', juni: '06', june: '06',
    jul: '07', juli: '07', july: '07',
    aug: '08', ags: '08', agustus: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', okt: '10', oktober: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', des: '12', desember: '12', december: '12'
  };

  const textParts = str.split(/[\/\.-_,\s]+/);
  if (textParts.length >= 3) {
    let dayStr: string | undefined;
    let monthStr: string | undefined;
    let yearStr: string | undefined;

    for (const p of textParts) {
      const lowerP = p.toLowerCase();
      if (MONTH_MAP[lowerP]) {
        monthStr = MONTH_MAP[lowerP];
      } else if (/^\d+$/.test(p)) {
        const num = parseInt(p, 10);
        if (p.length === 4) {
          yearStr = p;
        } else if (num > 31) {
          yearStr = String(num < 70 ? 2000 + num : 1900 + num);
        } else {
          if (!dayStr) dayStr = String(num).padStart(2, '0');
          else if (!yearStr) yearStr = String(num < 70 ? 2000 + num : 1900 + num);
        }
      }
    }

    if (dayStr && monthStr && yearStr) {
      return `${yearStr}-${monthStr}-${dayStr}`;
    }
  }

  // 5. String in M/D/YYYY or MM/DD/YYYY or D/M/YYYY or DD/MM/YYYY or D-M-YY or M-D-YY (e.g. 7/25/2026, 7/8/24)
  if (/^\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}/.test(str)) {
    const parts = str.split(/[\/\.-]/);
    const p1 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[1], 10);
    let yNum = parseInt(parts[2], 10);
    if (yNum < 100) {
      yNum = yNum < 70 ? 2000 + yNum : 1900 + yNum;
    }
    const y = String(yNum);

    let m: number;
    let d: number;

    if (p1 > 12) {
      d = p1;
      m = p2;
    } else if (p2 > 12) {
      m = p1;
      d = p2;
    } else {
      // In Indonesia, D/M/YYYY is standard.
      d = p1;
      m = p2;
    }

    const monthStr = String(m).padStart(2, '0');
    const dayStr = String(d).padStart(2, '0');
    return `${y}-${monthStr}-${dayStr}`;
  }

  // 6. String with ISO Timestamp "2026-07-25T00:00:00"
  if (str.includes('T')) {
    return str.split('T')[0];
  }

  // 7. Fallback to native JS Date parsing
  const parsedTs = Date.parse(str);
  if (!isNaN(parsedTs)) {
    const dt = new Date(parsedTs);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return str;
}

/**
 * Flexible case-insensitive, space-insensitive key-value extractor from Excel JSON rows
 * Evaluates candidate keys in strict priority order.
 */
export function getFlexibleValue(row: Record<string, any>, candidateKeys: string[], defaultValue: any = ''): any {
  if (!row || typeof row !== 'object') return defaultValue;

  const rowKeys = Object.keys(row);
  if (rowKeys.length === 0) return defaultValue;

  // Build a map of normalized row keys -> raw key name
  const rowKeyMap = new Map<string, string>();
  for (const rawKey of rowKeys) {
    const normKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!rowKeyMap.has(normKey)) {
      rowKeyMap.set(normKey, rawKey);
    }
  }

  // Iterate candidates in PRIORITY order
  for (const candidate of candidateKeys) {
    const normCandidate = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedRawKey = rowKeyMap.get(normCandidate);
    if (matchedRawKey !== undefined) {
      const val = row[matchedRawKey];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
  }

  // Smart fallback: search for row keys containing primary candidate keywords if no exact match found
  const hasQtyCandidate = candidateKeys.some(c => c.toLowerCase().includes('qty') || c.toLowerCase().includes('quantity') || c.toLowerCase().includes('jumlah'));
  if (hasQtyCandidate) {
    for (const rawKey of rowKeys) {
      const normKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Exclude non-qty fields
      if (normKey.includes('price') || normKey.includes('harga') || normKey.includes('cost') || normKey.includes('date') || normKey.includes('tgl') || normKey.includes('no') || normKey.includes('doc')) {
        continue;
      }
      if (normKey.includes('qty') || normKey.includes('quantity') || normKey.includes('jumlah') || normKey.includes('vol') || normKey.includes('pcs')) {
        const val = row[rawKey];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return val;
        }
      }
    }
  }

  return defaultValue;
}

/**
 * Safely parse numeric values from Excel/CSV (handles string numbers, thousand separators, Indonesian/US formats, etc.)
 */
export function parseNumericValue(val: any, defaultValue: number = 0): number {
  if (val === undefined || val === null || val === '') return defaultValue;
  if (typeof val === 'number') return isNaN(val) ? defaultValue : val;

  let str = String(val).trim();
  if (!str) return defaultValue;

  // Remove currency symbols (Rp, $, etc.) and spaces
  str = str.replace(/[Rp$\s]/gi, '');
  if (!str) return defaultValue;

  // Handles cases with both separators: e.g. "18,451.00" or "18.451,00"
  if (str.includes('.') && str.includes(',')) {
    if (str.indexOf('.') < str.indexOf(',')) {
      // European / ID format: 18.451,50 -> 18451.50
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 18,451.50 -> 18451.50
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Only comma present: e.g. "18,451" (US thousand) or "18,5" (EU decimal)
    if (/^\d{1,3}(,\d{3})+$/.test(str) || /^\d+,\d{3}$/.test(str)) {
      str = str.replace(/,/g, '');
    } else {
      str = str.replace(',', '.');
    }
  } else if (str.includes('.')) {
    // Only dot present: e.g. "18.451" (ID thousand) or "18.5" (US decimal)
    if (/^\d{1,3}(\.\d{3})+$/.test(str) || /^\d+\.\d{3}$/.test(str)) {
      str = str.replace(/\./g, '');
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Normalize Master Items mapped from Excel JSON
 */
export function mapExcelToMasterItems(rows: any[]): Partial<MasterItem>[] {
  return rows.map(row => {
    const itemCode = String(getFlexibleValue(row, ['itemcode', 'item_code', 'kodebarang', 'kodeitem', 'item', 'material', 'partnumber', 'partno'], '')).trim().toUpperCase();
    const itemName = String(getFlexibleValue(row, ['itemname', 'item_name', 'namabarang', 'namaitem', 'nama', 'description', 'deskripsi'], '')).trim();
    const groupName = String(getFlexibleValue(row, ['groupname', 'group_name', 'category', 'kategori', 'kelompok', 'grup'], 'Umum')).trim();
    const hargaJual = parseNumericValue(getFlexibleValue(row, ['hargajual', 'harga_jual', 'price', 'sellingprice'], 0), 0);
    const hargaBeli = parseNumericValue(getFlexibleValue(row, ['hargabeli', 'harga_beli', 'cost', 'buyprice'], 0), 0);
    const rawCreatedVal = getFlexibleValue(row, ['createddate', 'created_date', 'createdate', 'tglcreated', 'tanggalcreated', 'datecreated', 'created'], '');
    let createdDateStr: string | undefined = undefined;
    if (rawCreatedVal !== undefined && rawCreatedVal !== null && String(rawCreatedVal).trim() !== '') {
      createdDateStr = normalizeExcelDate(rawCreatedVal);
    }

    return {
      itemCode,
      itemName,
      groupName,
      hargaJual,
      hargaBeli,
      createdDate: createdDateStr
    };
  }).filter(item => item.itemCode && item.itemName);
}

/**
 * Normalize Transactions mapped from Excel JSON
 */
export function mapExcelToTransactions(rows: any[]): Partial<TransactionRecord>[] {
  return rows.map(row => {
    const rawDate = getFlexibleValue(row, [
      'postingdate', 'posting_date', 'tglposting', 'tanggalposting', 
      'docdate', 'documentdate', 'tgldo', 'tanggaldo', 'date', 'tanggal', 'tgl', 'createdat', 'created_at'
    ]);
    const postingDate = normalizeExcelDate(rawDate);

    const entryName = String(getFlexibleValue(row, ['entryname', 'entry_name', 'operator', 'user', 'entryby', 'arearmopr', 'rmopr', 'opr', 'createdby', 'salesadmin'], 'System')).trim();
    const rawDocNo = String(getFlexibleValue(row, ['documentno', 'document_no', 'nodo', 'donumber', 'nodokumen', 'notransaksi', 'docno', 'no', 'nomordo', 'nomordokumen', 'no_do', 'do_number', 'no_dokumen'], '')).trim();
    const documentNo = rawDocNo || 'SYSTEM';
    const itemCode = String(getFlexibleValue(row, ['itemcode', 'item_code', 'kodebarang', 'kodeitem', 'item', 'material', 'partnumber', 'partno', 'part_no', 'kode_barang', 'kode_item', 'sku'], '')).trim().toUpperCase();
    const category = String(getFlexibleValue(row, ['category', 'groupname', 'kategori', 'kelompok', 'status'], 'Umum')).trim();
    const remark = String(getFlexibleValue(row, ['remark', 'keterangan', 'ket', 'note', 'notes', 'areaspvopr', 'spvopr'], '-')).trim();
    const rawQty = getFlexibleValue(row, ['qty', 'quantity', 'jumlah', 'jumlahqty', 'qtydo', 'qty_do', 'pcs', 'totalqty', 'total_qty', 'qtyitem', 'qty_item', 'itemqty'], 0);
    const qty = Math.max(0, parseNumericValue(rawQty, 0));
    const fromLocation = String(getFlexibleValue(row, ['fromlocation', 'from', 'pengirim', 'asal', 'dari', 'fromloc', 'lokasiasal', 'darigudang', 'gudangasal'], '-')).trim();
    const toLocation = String(getFlexibleValue(row, ['tolocation', 'to', 'penerima', 'tujuan', 'ke', 'toloc', 'lokasitujuan', 'kegudang', 'customer', 'pelanggan'], '-')).trim();

    return {
      postingDate,
      entryName,
      documentNo,
      itemCode,
      category,
      remark,
      qty,
      fromLocation,
      toLocation
    };
  }).filter(t => t.itemCode && t.qty > 0);
}

/**
 * Normalize DO OPEN mapped from Excel JSON specifically for Status Updates / DO Insertions
 */
export function mapExcelToDoOpen(rows: any[]): Partial<DoOpenRecord>[] {
  return rows.map(row => {
    const rawDate = getFlexibleValue(row, [
      'postingdate', 'posting_date', 'tglposting', 'tanggalposting', 
      'docdate', 'documentdate', 'tgldo', 'tanggaldo', 'date', 'tanggal', 'tgl', 'createdat', 'created_at',
      'tgl_posting', 'tanggal_posting', 'tgl_do', 'tanggal_do'
    ]);
    const postingDate = normalizeExcelDate(rawDate);

    const entryName = String(getFlexibleValue(row, [
      'entryname', 'entry_name', 'arearmopr', 'rmopr', 'operator', 'user', 'entryby', 'createdby', 'salesadmin', 'rm',
      'area_rm_opr', 'admin', 'sales_admin'
    ], 'System')).trim();

    const documentNo = String(getFlexibleValue(row, [
      'documentno', 'document_no', 'nodo', 'donumber', 'nodokumen', 'docno', 'no', 'nomordo', 'nomordokumen', 'nodoopen',
      'nodo_open', 'nomerdo', 'no_do', 'do_number', 'no_dokumen', 'nomor_do', 'no_do_open', 'nomor_do_open', 'do', 'donum'
    ], '')).trim();

    const noDosl = String(getFlexibleValue(row, [
      'nodosl', 'no_dosl', 'dosl', 'nomordosl', 'nomor_dosl', 'no_do_sl', 'doslno', 'nodoslno', 'no.dosl', 'no. dosl',
      'nodoslsl', 'no_dosl_sl', 'doslnumber', 'dosl_number', 'slno', 'no_sl', 'nodosl_no'
    ], '-')).trim();

    const itemCode = String(getFlexibleValue(row, [
      'itemcode', 'item_code', 'kodebarang', 'kodeitem', 'item', 'material', 'partnumber', 'partno', 'part_no',
      'kode_barang', 'kode_item', 'sku', 'productcode', 'product_code', 'materialcode', 'material_code',
      'artikel', 'itemno', 'item_no', 'kode', 'kdbarang', 'kditem'
    ], '-')).trim().toUpperCase();
    
    // Priority order for Status DO OPEN column extraction
    const category = String(getFlexibleValue(row, [
      'statusdoopenseharusnya', 
      'statusseharusnya', 
      'statusdoopenbaru', 
      'statusdoopen', 
      'status_do_open', 
      'statusdo', 
      'status_do', 
      'status', 
      'category', 
      'kategori', 
      'groupname', 
      'keteranganstatus',
      'status_do_open_seharusnya',
      'status_do_seharusnya',
      'status_seharusnya',
      'status_baru',
      'keterangan_status',
      'status_do_open_baru'
    ], '')).trim();

    const remark = String(getFlexibleValue(row, [
      'areaspvopr', 'spvopr', 'spv', 'area_spv_opr', 'remark'
    ], '-')).trim();

    const keterangan = String(getFlexibleValue(row, [
      'keterangan', 'ket', 'notes', 'catatan', 'description', 'deskripsi', 'info', 'remark_notes'
    ], '-')).trim();

    const rawQty = getFlexibleValue(row, [
      'qty(pcs)', 'qty_pcs', 'qtypcs', 'quantitypcs', 'quantity_pcs', 'jumlahpcs', 'jumlah_pcs',
      'totalqty', 'total_qty', 'totalpcs', 'total_pcs',
      'qtyopen', 'qty_open', 'qtydoopen', 'qty_do_open', 'sisado', 'sisa_do',
      'sisaqty', 'qty_sisa', 'qtysisa', 'outstandingqty', 'qtyoutstanding', 'qty_outstanding',
      'qtydo', 'qty_do', 'quantity', 'qty', 'jumlah', 'jumlahqty', 'banyaknya', 'vol', 'volume', 'jml', 'jumlah_barang',
      'qtyitem', 'qty_item', 'itemqty', 'pcs'
    ], 0);
    const qty = Math.max(0, parseNumericValue(rawQty, 0));

    const fromLocation = String(getFlexibleValue(row, [
      'fromlocation', 'from', 'pengirim', 'asal', 'dari', 'fromloc', 'lokasiasal', 'darigudang', 'gudangasal',
      'from_location', 'lokasi_asal', 'gudang_asal'
    ], '-')).trim();

    const toLocation = String(getFlexibleValue(row, [
      'tolocation', 'to', 'penerima', 'tujuan', 'ke', 'toloc', 'lokasitujuan', 'kegudang', 'customer', 'pelanggan',
      'to_location', 'lokasi_tujuan', 'gudang_tujuan'
    ], '-')).trim();

    const itemName = String(getFlexibleValue(row, [
      'itemname', 'item_name', 'namabarang', 'nama_barang', 'namaitem', 'nama_item', 'nama', 'description', 'deskripsi'
    ], '')).trim();

    const groupName = String(getFlexibleValue(row, [
      'groupname', 'group_name', 'categoryname', 'category_name', 'kategori', 'category', 'kelompok', 'grup', 'nama_kategori'
    ], '')).trim();

    const rawHargaJual = getFlexibleValue(row, [
      'hargajual', 'harga_jual', 'hargajualsatuan', 'harga_jual_satuan', 'sellingprice', 'price'
    ], 0);
    let hargaJual = parseNumericValue(rawHargaJual, 0);

    const rawNilaiJual = getFlexibleValue(row, [
      'nilaijual(rp)', 'nilaijual', 'nilai_jual', 'nilai_jual_(rp)', 'nilai_jual_rp', 'totalnilaijual', 'nilai_jual_total'
    ], 0);
    const nilaiJual = parseNumericValue(rawNilaiJual, 0);

    if (hargaJual === 0 && nilaiJual > 0 && qty > 0) {
      hargaJual = Math.round((nilaiJual / qty) * 100) / 100;
    }

    const rawHargaBeli = getFlexibleValue(row, [
      'hargabeli', 'harga_beli', 'hargabelisatuan', 'harga_beli_satuan', 'cost', 'buyprice'
    ], 0);
    let hargaBeli = parseNumericValue(rawHargaBeli, 0);

    const rawNilaiBeli = getFlexibleValue(row, [
      'nilaibeli(rp)', 'nilaibeli', 'nilai_beli', 'nilai_beli_(rp)', 'nilai_beli_rp', 'totalnilaibeli', 'nilai_beli_total'
    ], 0);
    const nilaiBeli = parseNumericValue(rawNilaiBeli, 0);

    if (hargaBeli === 0 && nilaiBeli > 0 && qty > 0) {
      hargaBeli = Math.round((nilaiBeli / qty) * 100) / 100;
    }

    return {
      postingDate,
      entryName,
      documentNo,
      noDosl,
      itemCode,
      itemName: itemName || undefined,
      groupName: groupName || undefined,
      hargaJual: hargaJual || undefined,
      hargaBeli: hargaBeli || undefined,
      category,
      remark,
      qty,
      fromLocation,
      toLocation,
      keterangan
    };
  }).filter(t => Boolean(t.documentNo));
}
