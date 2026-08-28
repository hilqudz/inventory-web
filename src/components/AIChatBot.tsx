import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Bot, 
  Send, 
  X, 
  Sparkles, 
  Trash2, 
  Copy, 
  Check, 
  Loader2, 
  MessageSquare, 
  HelpCircle, 
  ChevronRight,
  Boxes,
  RotateCcw,
  Zap,
  Info,
  GripVertical,
  ArrowLeftRight
} from 'lucide-react';
import { MasterItem, TransactionRecord, DoOpenRecord, RequestDoRecord, ContainerRecord, getDoOpenLogistikGroup } from '../types';
import { getApiToken } from '../api';

interface AIChatBotProps {
  masterItems: MasterItem[];
  transaksiMasuk: TransactionRecord[];
  transaksiKeluar: TransactionRecord[];
  doOpen: DoOpenRecord[];
  requestDoOpen?: RequestDoRecord[];
  containers?: ContainerRecord[];
  userRole?: string;
  userDisplayName?: string;
  isEmbedded?: boolean;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
}

export const AIChatBot: React.FC<AIChatBotProps> = ({
  masterItems,
  transaksiMasuk,
  transaksiKeluar,
  doOpen,
  requestDoOpen = [],
  containers = [],
  userRole = 'Audit',
  userDisplayName = 'User',
  isEmbedded = false
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      sender: 'bot',
      text: `Halo ${userDisplayName}! Saya **AI Gudang Assistant**. 👋\n\nSaya dapat membantu Anda menjawab segala pertanyaan seputar **Nilai Jual Barang**, **Nilai Beli Barang (Modal)**, **Stok Fisik Gudang**, **Status Container Perjalanan**, **DO OPEN (QC vs Logistik)**, **Stok Lepasan**, hingga **Panduan Seluruh Fitur Web ini** secara akurat & cepat.\n\n*Silakan ketik pertanyaan Anda atau pilih pertanyaan cepat di bawah!*`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [loading, setLoading] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [dockPosition, setDockPosition] = useState<'right' | 'left'>(() => {
    try {
      const saved = localStorage.getItem('ai_bot_dock_position');
      if (saved === 'left' || saved === 'right') return saved;
    } catch (e) {}
    return 'right';
  });

  useEffect(() => {
    try {
      localStorage.setItem('ai_bot_dock_position', dockPosition);
    } catch (e) {}
  }, [dockPosition]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, loading]);

  // Quick suggestion prompts covering all web features and financials
  const quickPrompts = [
    '💰 Berapa total Nilai Jual & Nilai Beli sisa stok gudang?',
    '🏷️ Berapa harga jual, harga beli & nilai stok per item barang?',
    '📊 Berapa total sisa stok & nilai inventoris gudang?',
    '🚢 Berapa jumlah container OTW & Belum OTW saat ini?',
    '👥 Rekap DO OPEN per Area RM OPR?',
    '🚚 Ringkasan DO OPEN: Area QC vs Logistik?'
  ];

  // Synthesize Live Warehouse Snapshot with Smart Token Optimization
  const buildWarehouseContext = (queryText: string) => {
    const qLower = (queryText || '').toLowerCase();
    const keywords = qLower.split(/\s+/).filter(w => w.length >= 2);

    // 1. Container Status Context Synthesis
    let containerTiba = 0;
    let containerOtw = 0;
    let containerBelumOtw = 0;
    const matchedContainers: any[] = [];

    containers.forEach(c => {
      const st = c.statusContainer;
      if (st === 'Barang Sudah Tiba di Bintara') containerTiba++;
      else if (st === 'Container Masih OTW') containerOtw++;
      else if (st === 'Container Belum OTW') containerBelumOtw++;

      const matchesSearch = keywords.some(w =>
        (c.noContainer || '').toLowerCase().includes(w) ||
        (c.itemCategoryBarang || '').toLowerCase().includes(w) ||
        (c.category || '').toLowerCase().includes(w) ||
        (st || '').toLowerCase().includes(w) ||
        (c.remark || '').toLowerCase().includes(w)
      );

      if (matchesSearch || matchedContainers.length < 15) {
        matchedContainers.push({
          no: c.noContainer,
          cat: c.category,
          pK: c.tglTibaPriuk || '-',
          bK: c.tglTibaBintara || '-',
          item: c.itemCategoryBarang || '-',
          st: c.statusContainer,
          rm: c.remark || '-'
        });
      }
    });

    // 2. Master Item & Stock Aggregations
    const itemMap: Record<string, any> = {};

    masterItems.forEach(m => {
      itemMap[m.itemCode] = {
        itemCode: m.itemCode,
        itemName: m.itemName,
        groupName: m.groupName || 'Umum',
        hargaJual: m.hargaJual || 0,
        ...(userRole !== 'OPR' ? { hargaBeli: m.hargaBeli || 0 } : {}),
        totalMasuk: 0,
        totalKeluar: 0,
        sisaStock: 0,
        totalDoOpen: 0,
        qtyLepasan: 0
      };
    });

    transaksiMasuk.forEach(t => {
      if (!itemMap[t.itemCode]) {
        itemMap[t.itemCode] = {
          itemCode: t.itemCode,
          itemName: t.itemCode,
          groupName: t.category || 'Umum',
          hargaJual: 0,
          totalMasuk: 0,
          totalKeluar: 0,
          sisaStock: 0,
          totalDoOpen: 0,
          qtyLepasan: 0
        };
      }
      itemMap[t.itemCode].totalMasuk += (t.qty || 0);
    });

    transaksiKeluar.forEach(t => {
      if (!itemMap[t.itemCode]) {
        itemMap[t.itemCode] = {
          itemCode: t.itemCode,
          itemName: t.itemCode,
          groupName: t.category || 'Umum',
          hargaJual: 0,
          totalMasuk: 0,
          totalKeluar: 0,
          sisaStock: 0,
          totalDoOpen: 0,
          qtyLepasan: 0
        };
      }
      itemMap[t.itemCode].totalKeluar += (t.qty || 0);
    });

    doOpen.forEach(d => {
      if (itemMap[d.itemCode]) {
        itemMap[d.itemCode].totalDoOpen += (d.qty || 0);
      }
    });

    const itemSummaries = Object.values(itemMap).map((item: any) => {
      const sisaStock = item.totalMasuk - item.totalKeluar;
      const qtyLepasan = Math.max(0, sisaStock - item.totalDoOpen);
      return {
        ...item,
        sisaStock,
        qtyLepasan,
        nilaiJual: sisaStock * item.hargaJual,
        ...(userRole !== 'OPR' ? { nilaiBeli: sisaStock * (item.hargaBeli || 0) } : {})
      };
    });

    // 3. DO OPEN Groupings
    let countQC = 0;
    let qtyQC = 0;
    let countLogistik = 0;
    let qtyLogistik = 0;

    const areaRmMap: Record<string, { count: number; totalQty: number }> = {};
    const areaSpvMap: Record<string, { count: number; totalQty: number }> = {};

    const filteredDoOpenList: any[] = [];

    doOpen.forEach(d => {
      const group = getDoOpenLogistikGroup(d.category);
      if (group === 'BARANG MASIH ADA DI AREA QC') {
        countQC++;
        qtyQC += (d.qty || 0);
      } else {
        countLogistik++;
        qtyLogistik += (d.qty || 0);
      }

      const areaRm = d.entryName || 'Unassigned';
      const areaSpv = d.remark || 'Unassigned';

      if (!areaRmMap[areaRm]) areaRmMap[areaRm] = { count: 0, totalQty: 0 };
      areaRmMap[areaRm].count++;
      areaRmMap[areaRm].totalQty += (d.qty || 0);

      if (!areaSpvMap[areaSpv]) areaSpvMap[areaSpv] = { count: 0, totalQty: 0 };
      areaSpvMap[areaSpv].count++;
      areaSpvMap[areaSpv].totalQty += (d.qty || 0);

      // Smart DO Filter for Token Efficiency:
      const docNo = (d.documentNo || '').toLowerCase();
      const itemCode = (d.itemCode || '').toLowerCase();
      const rm = (d.entryName || '').toLowerCase();
      const spv = (d.remark || '').toLowerCase();
      const cat = (d.category || '').toLowerCase();

      const matchesSearch = keywords.some(w => 
        docNo.includes(w) || itemCode.includes(w) || rm.includes(w) || spv.includes(w) || cat.includes(w)
      );

      if (matchesSearch || filteredDoOpenList.length < 20) {
        filteredDoOpenList.push({
          doc: d.documentNo,
          item: d.itemCode,
          cat: d.category,
          qty: d.qty,
          rm: d.entryName || '-',
          spv: d.remark || '-',
          grp: group === 'BARANG MASIH ADA DI AREA QC' ? 'QC' : 'LOG'
        });
      }
    });

    const totalSisaStockQty = itemSummaries.reduce((acc, curr) => acc + curr.sisaStock, 0);
    const totalDoOpenQty = doOpen.reduce((acc, curr) => acc + (curr.qty || 0), 0);
    const totalQtyLepasan = Math.max(0, totalSisaStockQty - totalDoOpenQty);

    // Financial Valuations (Nilai Jual & Nilai Beli)
    const totalNilaiJualSisaStock = itemSummaries.reduce((acc, curr) => acc + (curr.nilaiJual || 0), 0);
    const totalNilaiBeliSisaStock = userRole !== 'OPR'
      ? itemSummaries.reduce((acc, curr) => acc + (curr.nilaiBeli || 0), 0)
      : undefined;

    const totalNilaiJualDoOpen = itemSummaries.reduce((acc, curr) => acc + (curr.totalDoOpen * (curr.hargaJual || 0)), 0);
    const totalNilaiBeliDoOpen = userRole !== 'OPR'
      ? itemSummaries.reduce((acc, curr) => acc + (curr.totalDoOpen * (curr.hargaBeli || 0)), 0)
      : undefined;

    const totalNilaiJualLepasan = itemSummaries.reduce((acc, curr) => acc + (curr.qtyLepasan * (curr.hargaJual || 0)), 0);
    const totalNilaiBeliLepasan = userRole !== 'OPR'
      ? itemSummaries.reduce((acc, curr) => acc + (curr.qtyLepasan * (curr.hargaBeli || 0)), 0)
      : undefined;

    const compactItemSummaries = itemSummaries.map(item => ({
      code: item.itemCode,
      name: item.itemName,
      cat: item.groupName,
      stk: item.sisaStock,
      do: item.totalDoOpen,
      lep: item.qtyLepasan,
      hj: item.hargaJual,
      nj: item.nilaiJual,
      ...(userRole !== 'OPR' ? { hb: item.hargaBeli, nb: item.nilaiBeli } : {})
    }));

    // Ultra-optimized Token-Saver Context Payload Builder
    const topHighestStock = [...compactItemSummaries]
      .sort((a, b) => b.stk - a.stk)
      .slice(0, 5);

    const topLowestStock = [...compactItemSummaries]
      .sort((a, b) => a.stk - b.stk)
      .slice(0, 5);

    const topHighestNilaiJual = [...compactItemSummaries]
      .sort((a, b) => b.nj - a.nj)
      .slice(0, 5);

    const topHighestNilaiBeli = userRole !== 'OPR'
      ? [...compactItemSummaries].sort((a, b) => (b.nb || 0) - (a.nb || 0)).slice(0, 5)
      : [];

    // Highly targeted item matches when keywords exist (max 10)
    const matchedItems = keywords.length > 0
      ? compactItemSummaries.filter(item => 
          keywords.some(w => 
            item.code.toLowerCase().includes(w) || 
            item.name.toLowerCase().includes(w) || 
            item.cat.toLowerCase().includes(w)
          )
        ).slice(0, 10)
      : [];

    const prunedDoOpenList = filteredDoOpenList.slice(0, 6);
    const prunedContainers = matchedContainers.slice(0, 6);

    // Top 5 RM & SPV
    const topRmOpr = Object.entries(areaRmMap)
      .sort((a, b) => b[1].totalQty - a[1].totalQty)
      .slice(0, 5)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

    const topSpvOpr = Object.entries(areaSpvMap)
      .sort((a, b) => b[1].totalQty - a[1].totalQty)
      .slice(0, 5)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

    return {
      totals: {
        items: masterItems.length,
        stock: totalSisaStockQty,
        doOpen: totalDoOpenQty,
        lepasan: totalQtyLepasan,
        financials: {
          totalNilaiJualSisaStock,
          totalNilaiBeliSisaStock,
          totalNilaiJualDoOpen,
          totalNilaiBeliDoOpen,
          totalNilaiJualLepasan,
          totalNilaiBeliLepasan
        },
        qcGroup: { count: countQC, qty: qtyQC },
        logGroup: { count: countLogistik, qty: qtyLogistik },
        containers: {
          total: containers.length,
          tibaBintara: containerTiba,
          masihOTW: containerOtw,
          belumOTW: containerBelumOtw
        }
      },
      allItems: compactItemSummaries.slice(0, 30),
      topHighestStock,
      topLowestStock,
      topHighestNilaiJual,
      ...(topHighestNilaiBeli.length > 0 ? { topHighestNilaiBeli } : {}),
      ...(matchedItems.length > 0 ? { searchMatchedItems: matchedItems } : {}),
      containers: prunedContainers,
      rmOpr: topRmOpr,
      spvOpr: topSpvOpr,
      doOpen: prunedDoOpenList
    };
  };

  const handleSendMessage = async (textToSend?: string) => {
    const queryText = (textToSend || inputMessage).trim();
    if (!queryText || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: queryText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setLoading(true);

    try {
      // Send last 2 messages safely to minimize token payload
      const historyContext = messages.slice(-2).map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        content: m.text.length > 400 ? m.text.slice(0, 400) : m.text
      }));

      const contextData = buildWarehouseContext(queryText);

      const apiToken = getApiToken();
      const response = await fetch('/api/chat-gudang', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
        },
        body: JSON.stringify({
          message: queryText,
          history: historyContext,
          context: contextData
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error status ${response.status}`);
      }

      const data = await response.json();

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: data.reply || 'Maaf, tidak ada tanggapan.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMsg: ChatMessage = {
        id: `bot-err-${Date.now()}`,
        sender: 'bot',
        text: `⚠️ **Gagal terhubung ke AI Gudang**: ${err.message || 'Terjadi gangguan jaringan atau server.'}\n\n*Pastikan server Express backend berjalan.*`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'bot',
        text: `Riwayat percakapan telah dibersihkan. Ada yang bisa AI Gudang bantu tentang data stok saat ini?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  };

  // Basic Markdown Renderer for structured text, bold, tables, lists
  const renderFormattedMarkdown = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let tableRows: string[][] = [];
    let inTable = false;

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      // Check for table row
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        inTable = true;
        const cells = trimmed
          .split('|')
          .slice(1, -1)
          .map(c => c.trim());
        
        // Skip separator row (e.g. |---|---|)
        if (!cells.every(c => /^:?-+:?$/.test(c))) {
          tableRows.push(cells);
        }
        return;
      } else if (inTable) {
        // Render completed table
        if (tableRows.length > 0) {
          const header = tableRows[0];
          const body = tableRows.slice(1);
          elements.push(
            <div key={`table-${index}`} className="my-2 overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left text-[11px] font-sans border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-white font-bold">
                    {header.map((h, i) => (
                      <th key={i} className="p-1.5 border-b border-slate-700">{parseBoldItalic(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white text-slate-800">
                  {body.map((row, rIdx) => (
                    <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="p-1.5 font-mono">{parseBoldItalic(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          tableRows = [];
        }
        inTable = false;
      }

      if (trimmed === '') {
        elements.push(<div key={`br-${index}`} className="h-1.5" />);
        return;
      }

      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        elements.push(
          <li key={`li-${index}`} className="ml-4 list-disc text-[11px] leading-relaxed text-slate-800 my-0.5">
            {parseBoldItalic(trimmed.substring(2))}
          </li>
        );
        return;
      }

      // Headers
      if (trimmed.startsWith('### ')) {
        elements.push(
          <h4 key={`h4-${index}`} className="font-bold text-slate-900 text-xs mt-2 mb-1">
            {parseBoldItalic(trimmed.substring(4))}
          </h4>
        );
        return;
      }
      if (trimmed.startsWith('## ')) {
        elements.push(
          <h3 key={`h3-${index}`} className="font-bold text-slate-900 text-xs text-blue-700 mt-2.5 mb-1 border-b pb-0.5">
            {parseBoldItalic(trimmed.substring(3))}
          </h3>
        );
        return;
      }

      // Normal paragraph
      elements.push(
        <p key={`p-${index}`} className="text-[11px] leading-relaxed text-slate-800 my-0.5">
          {parseBoldItalic(trimmed)}
        </p>
      );
    });

    // If string ended inside table
    if (inTable && tableRows.length > 0) {
      const header = tableRows[0];
      const body = tableRows.slice(1);
      elements.push(
        <div key="table-end" className="my-2 overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-left text-[11px] font-sans border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white font-bold">
                {header.map((h, i) => (
                  <th key={i} className="p-1.5 border-b border-slate-700">{parseBoldItalic(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white text-slate-800">
              {body.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="p-1.5 font-mono">{parseBoldItalic(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return elements;
  };

  // Helper to parse **bold** and *italic*
  const parseBoldItalic = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="italic text-slate-700">{part.slice(1, -1)}</em>;
      }
      return part;
    });
  };

  if (isEmbedded) {
    return (
      <div className="w-full h-[calc(100vh-125px)] min-h-[520px] bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden font-sans">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3.5 border-b border-slate-800 flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-purple-600 via-blue-600 to-indigo-600 text-white rounded-xl shadow-xs flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">Chat Bot Meta AI</h3>
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-semibold rounded-full">
                  Meta AI • Gemini 3.6
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                <span>Asisten Cerdas Stok Gudang Live • Role: {userRole} ({userDisplayName})</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearHistory}
              title="Bersihkan Chat"
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Bersihkan Chat</span>
            </button>
          </div>
        </div>

        {/* Quick Prompts Bar */}
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-2 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
          <span className="text-xs font-bold text-slate-500 shrink-0 font-mono flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            Pertanyaan Cepat Meta AI:
          </span>
          {quickPrompts.map((promptText, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(promptText.replace(/^[^\s]+\s*/, ''))}
              disabled={loading}
              className="shrink-0 text-xs bg-white hover:bg-purple-50 text-slate-700 hover:text-purple-700 border border-slate-200 hover:border-purple-300 px-2.5 py-1 rounded-lg font-medium transition shadow-2xs whitespace-nowrap cursor-pointer"
            >
              {promptText}
            </button>
          ))}
        </div>

        {/* Messages Container */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/50">
          {messages.map(msg => {
            const isUser = msg.sender === 'user';
            return (
              <div
                key={msg.id}
                className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div className={`p-2 rounded-full shrink-0 text-white text-xs shadow-2xs ${
                  isUser ? 'bg-slate-800' : 'bg-gradient-to-tr from-purple-600 to-indigo-600'
                }`}>
                  {isUser ? userDisplayName.charAt(0).toUpperCase() : <Bot className="w-4 h-4" />}
                </div>

                <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3.5 shadow-2xs border text-xs sm:text-sm leading-relaxed relative group ${
                  isUser 
                    ? 'bg-purple-700 text-white border-purple-800 rounded-tr-none' 
                    : 'bg-white text-slate-800 border-slate-200 rounded-tl-none'
                }`}>
                  {!isUser && (
                    <button
                      onClick={() => handleCopyText(msg.id, msg.text)}
                      className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg opacity-0 group-hover:opacity-100 transition"
                      title="Salin Pesan"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  <div className="space-y-1">
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    ) : (
                      renderFormattedMarkdown(msg.text)
                    )}
                  </div>

                  <div className={`text-[10px] font-mono mt-1.5 text-right ${
                    isUser ? 'text-purple-200' : 'text-slate-400'
                  }`}>
                    {msg.timestamp}
                  </div>
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-full shrink-0 bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-2xs">
                <Bot className="w-4 h-4 animate-spin" />
              </div>
              <div className="bg-white border border-slate-200 p-3 rounded-2xl shadow-2xs text-xs text-slate-600 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                <span>Meta AI sedang menganalisa data stok, status container, & DO OPEN secara real-time...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="p-3 bg-white border-t border-slate-200 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Tanyakan stok barang, No DO, atau status container ke Meta AI..."
              disabled={loading}
              className="flex-1 bg-slate-50 border border-slate-300 focus:border-purple-500 focus:bg-white focus:outline-hidden text-xs sm:text-sm rounded-xl px-3.5 py-2.5 text-slate-800 placeholder-slate-400 transition"
            />
            <button
              type="submit"
              disabled={loading || !inputMessage.trim()}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl transition shadow-sm flex items-center justify-center shrink-0 font-bold text-xs gap-1.5"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><span>Kirim</span><Send className="w-4 h-4" /></>}
            </button>
          </form>
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mt-2 px-1">
            <span>AI Gudang • Terhubung langsung dengan Database SQL Server</span>
            <span className="text-purple-600 font-semibold">BOD Executive AI Mode</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Floating Draggable Trigger Button */}
      {!isOpen && (
        <motion.div
          drag
          dragMomentum={false}
          dragElastic={0.05}
          className={`fixed z-50 cursor-grab active:cursor-grabbing select-none touch-none ${
            dockPosition === 'left' ? 'bottom-4 left-4' : 'bottom-4 right-4'
          }`}
        >
          <div className="flex items-center gap-1.5 bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 hover:from-blue-600 hover:to-indigo-600 text-white pl-2 pr-3 py-2 rounded-full shadow-2xl border border-blue-400/40 transition-all hover:scale-102 group">
            <div className="p-1 text-blue-200/60 group-hover:text-white" title="Klik & tahan untuk menggeser posisi tombol ini ke mana saja">
              <GripVertical className="w-4 h-4" />
            </div>
            
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="flex items-center gap-2 text-left focus:outline-none"
            >
              <div className="relative">
                <Bot className="w-5 h-5 text-white animate-pulse" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full ring-2 ring-blue-900" />
              </div>
              <span className="text-xs font-bold tracking-wide">Tanya AI Gudang</span>
              <span className="px-1.5 py-0.2 bg-white/20 text-[9px] font-mono font-bold rounded-full">
                REAL-TIME
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDockPosition(prev => prev === 'right' ? 'left' : 'right');
              }}
              className="p-1 ml-1 hover:bg-white/20 rounded-full transition text-blue-100 shrink-0"
              title={dockPosition === 'right' ? "Pindahkan tombol ke Kiri" : "Pindahkan tombol ke Kanan"}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}

      {/* Floating Chat Panel Drawer */}
      {isOpen && (
        <motion.div 
          drag
          dragHandle=".chat-drag-handle"
          dragMomentum={false}
          dragElastic={0.05}
          className={`fixed z-50 ${
            dockPosition === 'left'
              ? 'bottom-3 left-3 sm:bottom-4 sm:left-4'
              : 'bottom-3 right-3 sm:bottom-4 sm:right-4'
          } w-[95vw] sm:w-[440px] h-[580px] max-h-[85vh] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in duration-200 font-sans`}
        >
          
          {/* Header (Draggable Handle) */}
          <div className="chat-drag-handle bg-slate-900 text-white px-3.5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0 shadow-xs cursor-grab active:cursor-grabbing select-none">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-slate-500 hover:text-slate-300" title="Geser posisi jendela chat" />
              <div className="p-1.5 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white rounded-lg shadow-xs flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-bold text-xs text-white">AI Gudang Stock Assistant</h3>
                  <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-mono rounded">
                    Gemini 3.6
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                  <span>Akurasi Stok Live • Role: {userRole}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDockPosition(prev => prev === 'right' ? 'left' : 'right')}
                title={dockPosition === 'right' ? "Pindahkan panel ke Kiri" : "Pindahkan panel ke Kanan"}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleClearHistory}
                title="Bersihkan Chat"
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Tutup AI ChatBot"
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Prompts Bar */}
          <div className="bg-slate-100 border-b border-slate-200 px-2.5 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
            <span className="text-[10px] font-bold text-slate-500 shrink-0 font-mono flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              Cepat:
            </span>
            {quickPrompts.map((promptText, i) => (
              <button
                key={i}
                onClick={() => handleSendMessage(promptText.replace(/^[^\s]+\s*/, ''))}
                disabled={loading}
                className="shrink-0 text-[10px] bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2 py-0.5 rounded font-medium transition shadow-2xs whitespace-nowrap"
              >
                {promptText}
              </button>
            ))}
          </div>

          {/* Messages Container */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 bg-slate-50/50">
            {messages.map(msg => {
              const isUser = msg.sender === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`p-1.5 rounded-full shrink-0 text-white text-[10px] shadow-2xs ${
                    isUser ? 'bg-slate-700' : 'bg-gradient-to-tr from-blue-600 to-indigo-600'
                  }`}>
                    {isUser ? userDisplayName.charAt(0).toUpperCase() : <Bot className="w-3.5 h-3.5" />}
                  </div>

                  <div className={`max-w-[85%] rounded-lg p-2.5 shadow-2xs border text-xs leading-relaxed relative group ${
                    isUser 
                      ? 'bg-blue-600 text-white border-blue-700 rounded-tr-none' 
                      : 'bg-white text-slate-800 border-slate-200 rounded-tl-none'
                  }`}>
                    {/* Copy Button for Bot Messages */}
                    {!isUser && (
                      <button
                        onClick={() => handleCopyText(msg.id, msg.text)}
                        className="absolute top-1.5 right-1.5 p-1 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded opacity-0 group-hover:opacity-100 transition"
                        title="Salin Pesan"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    )}

                    <div className="space-y-1">
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      ) : (
                        renderFormattedMarkdown(msg.text)
                      )}
                    </div>

                    <div className={`text-[9px] font-mono mt-1 text-right ${
                      isUser ? 'text-blue-100' : 'text-slate-400'
                    }`}>
                      {msg.timestamp}
                    </div>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex items-start gap-2">
                <div className="p-1.5 rounded-full shrink-0 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-2xs">
                  <Bot className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="bg-white border border-slate-200 p-2.5 rounded-lg shadow-2xs text-xs text-slate-500 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  <span>Menganalisa data stok & menghitung persediaan real-time...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Footer */}
          <div className="p-2.5 bg-white border-t border-slate-200 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Tanyakan stok barang, No DO, atau alokasi lepasan..."
                disabled={loading}
                className="flex-1 bg-slate-50 border border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-hidden text-xs rounded-md px-3 py-2 text-slate-800 placeholder-slate-400 transition"
              />
              <button
                type="submit"
                disabled={loading || !inputMessage.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white p-2 rounded-md transition shadow-xs flex items-center justify-center shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
            <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono mt-1.5 px-1">
              <span>Data otomatis disinkronkan dari database.</span>
              <span className="text-blue-600">Gemini AI Powered</span>
            </div>
          </div>

        </motion.div>
      )}
    </>
  );
};
