import React, { useState, useEffect } from 'react';
import { addDoc, collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { OperationType } from '../../types';
import { processLedgerTransaction } from '../../lib/transaction-engine';
import { toast } from 'sonner';
import { CheckCircle2, FileText, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const InvoicingModule: React.FC<{ isDarkMode: boolean; formatCurrency?: (amount: number) => string }> = ({ isDarkMode, formatCurrency: propFormatCurrency }) => {
  const { user, handleFirestoreError, isPeriodClosed, usdToLbpRate, formatCurrency: ctxFormatCurrency, systemName, mofTaxId } = useFirebase();
  const formatCurrency = propFormatCurrency || ctxFormatCurrency;
  const [invoices, setInvoices] = useState<any[]>([]);
  const [includeVat11, setIncludeVat11] = useState<boolean>(true);
  const [formData, setFormData] = useState({
    client: '',
    tin: '',
    type: 'receivable' as 'receivable' | 'payable',
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    currency: 'USD',
    amount: '',
    description: '',
    lbpAmount: '',
  });

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'invoices'));
    return () => unsub();
  }, [user]);

  const effectiveRate = usdToLbpRate || 89500;

  const generateSequentialInvoiceNumber = (docType: 'receivable' | 'payable') => {
    const year = new Date().getFullYear();
    const prefix = docType === 'receivable' ? `INV-${year}-` : `BILL-${year}-`;
    const sameTypeCount = invoices.filter(i => (i.invoiceNumber || '').startsWith(prefix)).length;
    return `${prefix}${String(sameTypeCount + 1).padStart(4, '0')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isPeriodClosed(formData.date)) {
      return toast.error('Cannot post invoice. The reporting period is closed.');
    }

    let subtotalUSD = Number(formData.amount);
    if (formData.currency === 'LBP' && effectiveRate > 0) {
      subtotalUSD = subtotalUSD / effectiveRate;
    }

    const vatAmountUSD = includeVat11 ? Number((subtotalUSD * 0.11).toFixed(2)) : 0;
    const totalAmountUSD = Number((subtotalUSD + vatAmountUSD).toFixed(2));
    const subtotalLBP = Math.round(subtotalUSD * effectiveRate);
    const vatAmountLBP = Math.round(vatAmountUSD * effectiveRate);
    const totalAmountLBP = Math.round(totalAmountUSD * effectiveRate);
    const invoiceNumber = generateSequentialInvoiceNumber(formData.type);

    try {
      const invoiceRef = await addDoc(collection(db, 'invoices'), {
        ...formData,
        invoiceNumber,
        companyMofTaxId: mofTaxId || '',
        subtotalUSD,
        vatRate: includeVat11 ? 11 : 0,
        vatAmountUSD,
        vatAmountLBP,
        subtotalLBP,
        totalAmountLBP,
        amount: totalAmountUSD,
        totalAmount: totalAmountUSD,
        historicalFxRate: effectiveRate,
        status: 'issued',
        isB2BInvoice: true,
        createdAt: new Date().toISOString()
      });

      const isReceivable = formData.type === 'receivable';
      const res = await processLedgerTransaction({
        transactionType: isReceivable ? 'b2b_invoice' : 'supplier_bill',
        amount: totalAmountUSD,
        subtotal: subtotalUSD,
        paymentMethod: 'invoice',
        sourceModule: 'invoicing',
        sourceAccount: isReceivable ? '411 - Accounts Receivable — Clients & Members' : '601 - Cost of Goods Sold (COGS)',
        destinationAccount: isReceivable ? '706 - General Facility Revenue' : '401 - Accounts Payable — Suppliers',
        referenceId: invoiceRef.id,
        cashierId: user?.uid || 'system',
        direction: isReceivable ? 'inflow' : 'outflow',
        notes: `${invoiceNumber} — ${formData.description} (${formData.client})${includeVat11 ? ` [Incl. 11% VAT: ${vatAmountLBP.toLocaleString()} LBP]` : ''}`,
      });

      if (res?.transactionId) {
        await updateDoc(doc(db, 'advanced_transactions', res.transactionId), {
          accountingStatus: 'posted',
          postedAt: new Date().toISOString(),
          postedBy: user?.uid,
          isB2BInvoice: true,
          exchangeRateAtPosting: effectiveRate
        });
      }

      toast.success(`Official MOF Invoice ${invoiceNumber} issued and posted to both Ledgers.`);
      setFormData({
        client: '',
        tin: '',
        type: 'receivable',
        date: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        currency: 'USD',
        amount: '',
        description: '',
        lbpAmount: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'invoices');
    }
  };

  const handleMarkPaid = async (inv: any) => {
    try {
      const currentRate = usdToLbpRate || 89500;
      await updateDoc(doc(db, 'invoices', inv.id), {
        status: 'paid',
        paidAt: new Date().toISOString(),
        settledFxRate: currentRate
      });
      const isReceivable = (inv.type || 'receivable') === 'receivable';
      const invAmountUSD = Number(inv.totalAmount ?? inv.amount ?? 0);

      const res = await processLedgerTransaction({
        transactionType: isReceivable ? 'invoice_settlement' : 'bill_settlement',
        amount: invAmountUSD,
        paymentMethod: 'bank_transfer',
        sourceModule: 'invoicing',
        sourceAccount: isReceivable ? '512 - Bank Accounts (Fresh USD / LBP)' : '401 - Accounts Payable — Suppliers',
        destinationAccount: isReceivable ? '411 - Accounts Receivable — Clients & Members' : '512 - Bank Accounts (Fresh USD / LBP)',
        referenceId: inv.id,
        cashierId: user?.uid || 'system',
        direction: isReceivable ? 'inflow' : 'outflow',
        notes: `Settlement for ${inv.invoiceNumber || inv.id.slice(-6)} — ${inv.client} (${inv.description})`
      });
      if (res?.transactionId) {
        await updateDoc(doc(db, 'advanced_transactions', res.transactionId), {
          accountingStatus: 'posted',
          postedAt: new Date().toISOString(),
          postedBy: user?.uid,
          isB2BInvoice: true,
          exchangeRateAtPosting: currentRate
        });
      }

      // Automated Realized FX Gain / Loss (LCOA 676 / 776) if FX rate shifted between issuance and settlement
      const lockedRate = Number(inv.historicalFxRate || currentRate);
      if (lockedRate > 0 && currentRate > 0 && Math.abs(currentRate - lockedRate) >= 100 && invAmountUSD > 0) {
        const lbpDiff = invAmountUSD * (currentRate - lockedRate);
        const fxDiffUSD = Number((Math.abs(lbpDiff) / currentRate).toFixed(2));
        if (fxDiffUSD >= 0.01) {
          const isGain = isReceivable ? currentRate > lockedRate : currentRate < lockedRate;
          await processLedgerTransaction({
            transactionType: isGain ? 'fx_gain' : 'fx_loss',
            amount: fxDiffUSD,
            paymentMethod: 'system',
            sourceModule: 'invoicing',
            sourceAccount: isGain
              ? '512 - Bank Accounts (Fresh USD / LBP)'
              : '676 - Foreign Exchange Losses (Différences de Change Négatives)',
            destinationAccount: isGain
              ? '776 - Foreign Exchange Gains (Différences de Change Positives)'
              : '512 - Bank Accounts (Fresh USD / LBP)',
            referenceId: inv.id,
            cashierId: user?.uid || 'system',
            direction: isGain ? 'inflow' : 'outflow',
            notes: `Realized FX ${isGain ? 'Gain (LCOA 776)' : 'Loss (LCOA 676)'} on ${inv.invoiceNumber || inv.client} (Issued @ ${lockedRate.toLocaleString()} vs Settled @ ${currentRate.toLocaleString()} LBP)`
          });
        }
      }

      toast.success(`Invoice ${inv.invoiceNumber || ''} for ${inv.client} marked as Paid.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `invoices/${inv.id}`);
    }
  };

  const handleDownloadMOFInvoicePDF = (inv: any) => {
    const pdf = new jsPDF();
    const rate = Number(inv.historicalFxRate || effectiveRate);
    const totalUSD = Number(inv.totalAmount ?? inv.amount ?? 0);
    const vatRate = Number(inv.vatRate ?? 0);
    const subUSD = inv.subtotalUSD !== undefined ? Number(inv.subtotalUSD) : vatRate > 0 ? totalUSD / (1 + vatRate / 100) : totalUSD;
    const vatUSD = inv.vatAmountUSD !== undefined ? Number(inv.vatAmountUSD) : totalUSD - subUSD;
    const subLBP = inv.subtotalLBP !== undefined ? Number(inv.subtotalLBP) : Math.round(subUSD * rate);
    const vatLBP = inv.vatAmountLBP !== undefined ? Number(inv.vatAmountLBP) : Math.round(vatUSD * rate);
    const totLBP = inv.totalAmountLBP !== undefined ? Number(inv.totalAmountLBP) : Math.round(totalUSD * rate);
    const invNum = inv.invoiceNumber || `INV-${new Date(inv.date || Date.now()).getFullYear()}-${inv.id.slice(-4).toUpperCase()}`;

    pdf.setFillColor(11, 15, 23);
    pdf.rect(0, 0, 210, 46, 'F');
    pdf.setFillColor(0, 184, 200);
    pdf.rect(0, 46, 210, 1.5, 'F');

    pdf.setFontSize(15);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`${systemName || 'Vescio Nexus'} — OFFICIAL TAX INVOICE (FACTURE)`, 14, 14);
    pdf.setFontSize(9);
    pdf.setTextColor(0, 184, 200);
    pdf.text(`Company MOF Tax ID (Numéro Fiscal): ${inv.companyMofTaxId || mofTaxId || 'Registered Lebanese Taxpayer'}`, 14, 22);
    pdf.setTextColor(212, 212, 216);
    pdf.text(`Invoice Number: ${invNum} | Issue Date: ${inv.date} | Due Date: ${inv.dueDate || '-'}`, 14, 29);
    pdf.text(`Counterparty: ${inv.client} | Counterparty MOF TIN: ${inv.tin || 'N/A'}`, 14, 35);
    pdf.text(`Official Locked Exchange Rate (Sayrafa / Market): 1 USD = ${rate.toLocaleString()} LBP`, 14, 41);

    autoTable(pdf, {
      startY: 54,
      head: [['Description', 'Net Subtotal (USD)', 'VAT 11% (USD)', 'Total (USD)', 'Total Equivalent (LBP)']],
      body: [
        [
          inv.description || 'Professional / Commercial Services',
          `$${subUSD.toFixed(2)}`,
          `$${vatUSD.toFixed(2)}`,
          `$${totalUSD.toFixed(2)}`,
          `${totLBP.toLocaleString()} LBP`
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [0, 184, 200], textColor: [11, 15, 23], fontStyle: 'bold' },
      styles: { fontSize: 9 }
    });

    const nextY = (pdf as any).lastAutoTable.finalY + 8;
    pdf.setFontSize(10);
    pdf.setTextColor(11, 15, 23);
    pdf.text('Lebanese Ministry of Finance (MOF) Mandatory LBP Tax Breakdown:', 14, nextY);

    autoTable(pdf, {
      startY: nextY + 4,
      head: [['Tax Component (LCOA)', 'USD Amount ($)', 'Mandatory LBP Equivalent (ل.ل)']],
      body: [
        ['Net Taxable Base (Hors Taxes)', `$${subUSD.toFixed(2)}`, `${subLBP.toLocaleString()} LBP`],
        [`Lebanese VAT ${vatRate}% (TVA — LCOA 442)`, `$${vatUSD.toFixed(2)}`, `${vatLBP.toLocaleString()} LBP`],
        ['TOTAL TTC (Toutes Taxes Comprises)', `$${totalUSD.toFixed(2)}`, `${totLBP.toLocaleString()} LBP`]
      ],
      theme: 'striped',
      headStyles: { fillColor: [11, 15, 23], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9 }
    });

    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 130);
    pdf.text('Generated by Vescio Nexus ERP', 14, 288);

    pdf.save(`${invNum}_${inv.client.replace(/\s+/g, '_')}.pdf`);
    toast.success(`Official MOF Tax Invoice ${invNum} downloaded!`);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="bg-white dark:bg-[#0B0F17]/90 p-6 rounded-2xl border border-slate-200 dark:border-zinc-800/80 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/30">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Issue Official MOF Sequential Tax Invoice / Supplier Bill</h2>
              <p className="text-xs text-zinc-500">
                Sequential numbering (`INV-YYYY-XXXX`), MOF Tax ID (`{mofTaxId || 'Configure in Settings'}`), and mandatory LBP VAT equivalent
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-xl text-xs font-mono font-bold bg-cyan-500/10 text-[#00B8C8] border border-cyan-500/30">
            Next: {generateSequentialInvoiceNumber(formData.type)}
          </span>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Document Type</label>
              <select value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value as any })} className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm font-bold">
                <option value="receivable">Client Invoice (AR - 411)</option>
                <option value="payable">Supplier Bill (AP - 401)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Client / Supplier Name</label>
              <input required value={formData.client} onChange={e => setFormData({ ...formData, client: e.target.value })} type="text" className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent" placeholder="e.g. Corporate Sponsor SARL" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Counterparty MOF Tax ID (TIN)</label>
              <input value={formData.tin} onChange={e => setFormData({ ...formData, tin: e.target.value })} type="text" className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent" placeholder="MOF TIN..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Invoice Date</label>
              <input required type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Due Date</label>
              <input required type="date" value={formData.dueDate} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Currency & Net Amount</label>
              <div className="flex gap-2">
                <select value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })} className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent font-bold text-sm">
                  <option value="USD">USD</option>
                  <option value="LBP">LBP</option>
                </select>
                <input required value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} type="number" step="0.01" className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent font-mono" placeholder="0.00" />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Description</label>
              <input required value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} type="text" className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent" placeholder="Description of goods, sponsorship, or services" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeVat11}
                  onChange={e => setIncludeVat11(e.target.checked)}
                  className="rounded accent-[#00B8C8] text-[#00B8C8]"
                />
                Apply 11% Lebanese VAT (LCOA 442)
              </label>
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 mt-4 bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 rounded-xl font-bold transition-colors shadow-sm shadow-cyan-500/20">
            Issue Official MOF Tax Invoice & Post to Ledger
          </button>
        </form>
      </div>

      {/* Live Invoices Register */}
      <div className="bg-white dark:bg-[#0B0F17] p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm">
        <h3 className="text-lg font-bold mb-4">Issued Invoices & Bills Register</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-zinc-800 text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Counterparty</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4 text-right">Total (TTC)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500">No formal invoices or bills issued yet.</td>
                </tr>
              ) : (
                invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-zinc-800/30">
                    <td className="py-3 px-4 font-mono text-xs font-bold text-[#0099A8] dark:text-[#00B8C8]">
                      {inv.invoiceNumber || `INV-${inv.id.slice(-4).toUpperCase()}`}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">{inv.date}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${(inv.type || 'receivable') === 'receivable' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                        {inv.type || 'receivable'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold">{inv.client} {inv.tin ? <span className="text-xs font-normal text-zinc-400">({inv.tin})</span> : null}</td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">
                      <div>{inv.description}</div>
                      {inv.vatAmountLBP > 0 && (
                        <div className="text-[10px] font-mono text-amber-500">
                          VAT 11%: {Number(inv.vatAmountLBP).toLocaleString()} LBP
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold">
                      <div>{formatCurrency(Number(inv.totalAmount ?? inv.amount ?? 0))}</div>
                      {inv.historicalFxRate && (
                        <div className="text-[10px] text-zinc-400">
                          @ {Number(inv.historicalFxRate).toLocaleString()} LBP
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${inv.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                        {inv.status || 'issued'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleDownloadMOFInvoicePDF(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B8C8]/10 hover:bg-[#00B8C8]/20 text-[#0099A8] dark:text-[#00B8C8] border border-[#00B8C8]/25 text-xs font-bold transition-colors"
                          title="Download Official MOF Tax Invoice PDF"
                        >
                          <Download size={12} /> MOF PDF
                        </button>
                        {inv.status !== 'paid' && (
                          <button
                            onClick={() => handleMarkPaid(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-bold transition-colors"
                          >
                            <CheckCircle2 size={12} /> Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
