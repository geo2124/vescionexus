import React, { useState } from 'react';
import { Upload, CheckCircle2, AlertCircle, FileText, Bot, RefreshCw } from 'lucide-react';

interface BankReconciliationProps {
  isDarkMode: boolean;
  formatCurrency: (val: number) => string;
  transactions: any[];
}

export const BankReconciliation: React.FC<BankReconciliationProps> = ({ isDarkMode, formatCurrency, transactions }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedStatement, setParsedStatement] = useState<any[] | null>(null);

  // Mock ledger bank transactions (unreconciled)
  const bankTransactions = transactions.filter(t => 
    (t.sourceAccount?.includes('bank') || t.destinationAccount?.includes('bank')) &&
    !t.reconciled
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsUploading(true);
      setTimeout(() => {
        setIsUploading(false);
        setIsParsing(true);
        // Simulate AI parsing time
        setTimeout(() => {
          setIsParsing(false);
          // Generate mock parsed statement based on existing transactions to show matching
          const mockParsed = bankTransactions.slice(0, 3).map(t => ({
            id: Math.random().toString(36).substring(7),
            date: t.createdAt ? new Date(t.createdAt.seconds * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            description: `Bank Transfer - Ref ${Math.floor(Math.random() * 10000)}`,
            amount: t.amount,
            type: t.destinationAccount?.includes('bank') ? 'deposit' : 'withdrawal',
            status: 'matched',
            systemMatchId: t.id
          }));
          
          setParsedStatement([
            ...mockParsed,
            {
              id: 'unmatched-1',
              date: new Date().toISOString().split('T')[0],
              description: 'ATM Withdrawal - Unrecognized',
              amount: 150,
              type: 'withdrawal',
              status: 'unmatched',
              systemMatchId: null
            }
          ]);
        }, 2000);
      }, 1000);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold font-sans tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
             AI Bank Statement Reconciliation
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Upload PDF/Excel statements and let AI auto-match with ledger entries.</p>
        </div>
      </div>

      {!parsedStatement ? (
        <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-12 text-center bg-white dark:bg-zinc-900 flex flex-col items-center justify-center">
          {isUploading ? (
            <div className="flex flex-col items-center">
              <RefreshCw className="animate-spin text-purple-500 mb-4" size={32} />
              <p className="text-zinc-600 dark:text-zinc-400 font-medium">Uploading document...</p>
            </div>
          ) : isParsing ? (
            <div className="flex flex-col items-center">
              <Bot className="animate-bounce text-purple-500 mb-4" size={32} />
              <p className="text-zinc-600 dark:text-zinc-400 font-medium">AI is reading transactions...</p>
            </div>
          ) : (
            <>
              <div className="w-16 h-16 bg-purple-500/10 text-purple-600 rounded-full flex items-center justify-center mb-4">
                <Upload size={24} />
              </div>
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">Upload Bank Statement</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
                Drop your bank's PDF or CSV export here. Our parser works perfectly with local Lebanese bank formats.
              </p>
              <label className="px-6 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-sm font-bold cursor-pointer hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors">
                <input type="file" className="hidden" accept=".pdf,.csv,.xlsx" onChange={handleFileUpload} />
                Select File
              </label>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
             <Bot className="text-purple-600 dark:text-purple-400" size={24} />
             <div>
               <h4 className="font-bold text-purple-900 dark:text-purple-300">AI Parsing Complete</h4>
               <p className="text-sm text-purple-700 dark:text-purple-400">Successfully extracted {parsedStatement.length} entries. Found matches for {parsedStatement.filter(x => x.status === 'matched').length} transactions.</p>
             </div>
          </div>
          
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
             <table className="w-full text-left text-sm">
                <thead className={`text-xs uppercase text-zinc-500 dark:text-zinc-400 font-bold bg-slate-50 dark:bg-zinc-950/50 border-b border-zinc-200 dark:border-zinc-800`}>
                  <tr>
                    <th className="p-4">Date</th>
                    <th className="p-4">Bank Description</th>
                    <th className="p-4 text-right">Amount</th>
                    <th className="p-4">AI Match Status</th>
                    <th className="p-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 font-mono text-xs">
                  {parsedStatement.map((row, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-colors">
                      <td className="p-4">{row.date}</td>
                      <td className="p-4 font-sans">{row.description}</td>
                      <td className={`p-4 text-right ${row.type === 'deposit' ? 'text-emerald-500' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {row.type === 'deposit' ? '+' : '-'}{formatCurrency(row.amount)}
                      </td>
                      <td className="p-4 font-sans">
                        {row.status === 'matched' ? (
                          <div className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                             <CheckCircle2 size={14} /> Exact Match Found
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                             <AlertCircle size={14} /> Needs Review
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <button className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider ${row.status === 'matched' ? 'bg-emerald-500 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>
                          {row.status === 'matched' ? 'Reconcile' : 'Find Match'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
             </table>
          </div>
        </div>
      )}
    </div>
  );
};
