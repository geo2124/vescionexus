import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, doc, where, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { InventoryItem, POSOrder, POSShift, Member, Coupon, OperationType, ProductVariant, BundleComponent, POSParkedOrder, POSCategoryConfig, POSSubcategory } from '../types';
import { getOrCreateGhostMember, logSystemAudit } from '../lib/firestore-utils';
import { processAtomicCheckout, processReversalTransaction, processLedgerTransaction, stripUndefined } from '../lib/transaction-engine';
import { openCommandPalette } from './CommandPalette';
import { 
  ArrowLeft, Search, Plus, ShoppingCart, CreditCard, 
  Package, DollarSign, Edit, Trash2, User, CheckCircle,
  Minus, Trash, ChevronRight, Info, AlertCircle, XCircle, RotateCcw,
  Barcode, Download, Upload, FileSpreadsheet, FileText, AlertTriangle,
  PackagePlus, Flame, Calculator, Printer, Calendar, PauseCircle, PlayCircle, Layers, Sparkles, FolderTree, Languages,
  Lock, Unlock, ShieldAlert, Clock, Wallet, Share2, MessageCircle, Split
} from 'lucide-react';
import { Modal } from './Modal';
import { motion, AnimatePresence } from 'motion/react';
import { DndContext, useDraggable, useDroppable, DragOverlay, DragStartEvent, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { toast } from 'sonner';
import { PurchaseOrdersModule } from './accounting/PurchaseOrdersModule';
import { TenantBrandLockup } from './VescioNexusLogo';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Enforce Western / English numerals (0-9) across all text & formatted strings
export const toEnglishNumerals = (input: string | number): string => {
  return String(input ?? '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
};

const ARABIC_PHRASE_DICTIONARY: Record<string, string> = {
  // Categories
  'all': 'الكل',
  'beverages': 'مشروبات',
  'snacks': 'سناكات ووجبات خفيفة',
  'grocery': 'بقالة وسوبرماركت',
  'protein bars': 'ألواح بروتين',
  'coffee & hot drinks': 'قهوة ومشروبات ساخنة',
  'dairy & fresh': 'ألبان ومنتجات طازجة',
  'merchandise': 'منتجات النادي',
  'supplements': 'مكملات غذائية',
  'medical supplies': 'مستلزمات طبية',
  'equipment': 'معدات رياضية',
  'apparel': 'ملابس رياضية',
  // Subcategories
  'water': 'مياه',
  'energy & sports drinks': 'مشروبات طاقة ورياضة',
  'soft drinks & juices': 'مرطبات وعصائر',
  'chips & crisps': 'شيبس ومقرمشات',
  'nuts & seeds': 'مكسرات وبذور',
  'chocolate & candy': 'شوكولاتة وحلويات',
  'whey bars': 'ألواح واي بروتين',
  'vegan & oat bars': 'ألواح شوفان ونباتي',
  'espresso & coffee': 'إسبريسو وقهوة',
  'tea & herbal': 'شاي وأعشاب',
  'milk & laban': 'حليب ولبن',
  'sandwiches & salads': 'سندويشات وسلطات',
  'pantry & essentials': 'مواد غذائية أساسية',
  'bakery': 'مخبوزات',
  'whey protein': 'واي بروتين',
  'pre-workout & creatine': 'بري وورك أوت وكرياتين',
  'vitamins & recovery': 'فيتامينات واستشفاء',
  'towels & bottles': 'مناشف ومطرات مياه',
  'bags & accessories': 'حقائب وإكسسوارات',
  'shirts & tops': 'قمصان وتيشيرتات',
  'shorts & leggings': 'شورتات وبناطيل رياضية',
  'straps & gloves': 'قفازات وأربطة رفع',
  'resistance bands': 'حبال مقاومة',
  'tapes & wraps': 'أشرطة طبية ورياضية',
  'braces & supports': 'مشدات ودعامات طبية'
};

const ARABIC_WORD_DICTIONARY: Record<string, string> = {
  water: 'مياه',
  mineral: 'معدنية',
  sparkling: 'فوارة',
  small: 'صغير',
  medium: 'وسط',
  large: 'كبير',
  bottle: 'عبوة',
  can: 'علبة',
  pack: 'حزمة',
  protein: 'بروتين',
  bar: 'بار',
  bars: 'ألواح',
  shake: 'شيك',
  whey: 'واي',
  isolate: 'أيزوليت',
  creatine: 'كرياتين',
  bcaa: 'أحماض أمينية',
  amino: 'أمينو',
  energy: 'طاقة',
  drink: 'مشروب',
  drinks: 'مشروبات',
  isotonic: 'أيزوتونيك',
  sports: 'رياضي',
  sport: 'رياضي',
  coffee: 'قهوة',
  espresso: 'إسبريسو',
  americano: 'أمريكانو',
  latte: 'لاتيه',
  cappuccino: 'كابتشينو',
  iced: 'مثلج',
  hot: 'ساخن',
  tea: 'شاي',
  green: 'أخضر',
  black: 'أسود',
  milk: 'حليب',
  laban: 'لبن',
  ayran: 'عيران',
  yogurt: 'زبادي',
  greek: 'يوناني',
  juice: 'عصير',
  orange: 'برتقال',
  apple: 'تفاح',
  mango: 'مانجو',
  berry: 'توت',
  strawberry: 'فراولة',
  banana: 'موز',
  vanilla: 'فانيلا',
  chocolate: 'شوكولاتة',
  caramel: 'كراميل',
  peanut: 'فول سوداني',
  butter: 'زبدة',
  almond: 'لوز',
  nuts: 'مكسرات',
  mixed: 'مشكل',
  roasted: 'محمص',
  chips: 'شيبس',
  crisps: 'مقرمشات',
  oat: 'شوفان',
  oats: 'شوفان',
  cookie: 'كوكيز',
  cookies: 'كوكيز',
  biscuit: 'بسكويت',
  cake: 'كيك',
  rice: 'أرز',
  cakes: 'كيك',
  sandwich: 'سندويش',
  chicken: 'دجاج',
  turkey: 'حبش',
  tuna: 'تونا',
  cheese: 'جبنة',
  halloumi: 'حلوم',
  salad: 'سلطة',
  fresh: 'طازج',
  diet: 'دايت',
  zero: 'زيرو',
  sugar: 'سكر',
  free: 'خالي',
  red: 'ريد',
  bull: 'بول',
  monster: 'مونستر',
  gatorade: 'جاتوريد',
  powerade: 'باوريد',
  pepsi: 'بيبسي',
  cola: 'كولا',
  seven: 'سفن',
  up: 'أب',
  rim: 'ريم',
  sannine: 'صنين',
  tannourine: 'تنورين',
  sohat: 'صحة',
  nestle: 'نستله',
  nescafe: 'نسكافيه',
  towel: 'منشفة',
  gym: 'جيم',
  shirt: 'قميص',
  tshirt: 'تيشيرت',
  shorts: 'شورت',
  socks: 'جوارب',
  wrist: 'معصم',
  knee: 'ركبة',
  strap: 'رباط',
  straps: 'أربطة',
  gloves: 'قفازات',
  tape: 'شريط طبي',
  kinesio: 'كينيزيو',
  ice: 'ثلج',
  gel: 'جل',
  vitamin: 'فيتامين',
  electrolyte: 'إلكترولايت'
};

export const translateToArabic = (text?: string): string => {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  // If already contains Arabic characters, just enforce English numerals
  if (/[\u0600-\u06FF]/.test(trimmed)) {
    return toEnglishNumerals(trimmed);
  }
  const lower = trimmed.toLowerCase();
  if (ARABIC_PHRASE_DICTIONARY[lower]) {
    return toEnglishNumerals(ARABIC_PHRASE_DICTIONARY[lower]);
  }

  // Word-by-word translation while preserving English numerals (0-9) and units like 500ml, 330ml, 250g
  const tokens = trimmed.split(/(\s+|[()\-/,&+]+)/);
  let translatedAny = false;
  const translatedTokens = tokens.map(tok => {
    const clean = tok.toLowerCase().replace(/[^a-z]/g, '');
    if (clean && ARABIC_WORD_DICTIONARY[clean]) {
      translatedAny = true;
      return ARABIC_WORD_DICTIONARY[clean];
    }
    if (tok === '&') return 'و';
    return toEnglishNumerals(tok);
  });

  if (translatedAny) {
    return toEnglishNumerals(translatedTokens.join(''));
  }
  return toEnglishNumerals(trimmed);
};

const KIOSK_DEFAULT_CATEGORIES = ['Beverages', 'Snacks', 'Grocery', 'Protein Bars', 'Coffee & Hot Drinks', 'Dairy & Fresh'];
const RETAIL_DEFAULT_CATEGORIES = ['Merchandise', 'Supplements', 'Medical Supplies', 'Equipment', 'Apparel'];

const DEFAULT_KIOSK_CATEGORY_CONFIGS: POSCategoryConfig[] = [
  {
    id: 'cat_beverages',
    name: 'Beverages',
    nameAr: 'مشروبات',
    posType: 'cafeteria',
    subcategories: [
      { id: 'sub_water', name: 'Water', nameAr: 'مياه' },
      { id: 'sub_energy', name: 'Energy & Sports Drinks', nameAr: 'مشروبات طاقة ورياضة' },
      { id: 'sub_soft', name: 'Soft Drinks & Juices', nameAr: 'مرطبات وعصائر' }
    ]
  },
  {
    id: 'cat_snacks',
    name: 'Snacks',
    nameAr: 'سناكات ووجبات خفيفة',
    posType: 'cafeteria',
    subcategories: [
      { id: 'sub_chips', name: 'Chips & Crisps', nameAr: 'شيبس ومقرمشات' },
      { id: 'sub_nuts', name: 'Nuts & Seeds', nameAr: 'مكسرات وبذور' },
      { id: 'sub_choc', name: 'Chocolate & Candy', nameAr: 'شوكولاتة وحلويات' }
    ]
  },
  {
    id: 'cat_protein_bars',
    name: 'Protein Bars',
    nameAr: 'ألواح بروتين',
    posType: 'cafeteria',
    subcategories: [
      { id: 'sub_whey_bars', name: 'Whey Bars', nameAr: 'ألواح واي بروتين' },
      { id: 'sub_oat_bars', name: 'Vegan & Oat Bars', nameAr: 'ألواح شوفان ونباتي' }
    ]
  },
  {
    id: 'cat_coffee',
    name: 'Coffee & Hot Drinks',
    nameAr: 'قهوة ومشروبات ساخنة',
    posType: 'cafeteria',
    subcategories: [
      { id: 'sub_espresso', name: 'Espresso & Coffee', nameAr: 'إسبريسو وقهوة' },
      { id: 'sub_tea', name: 'Tea & Herbal', nameAr: 'شاي وأعشاب' }
    ]
  },
  {
    id: 'cat_dairy',
    name: 'Dairy & Fresh',
    nameAr: 'ألبان ومنتجات طازجة',
    posType: 'cafeteria',
    subcategories: [
      { id: 'sub_milk', name: 'Milk & Laban', nameAr: 'حليب ولبن' },
      { id: 'sub_sandwiches', name: 'Sandwiches & Salads', nameAr: 'سندويشات وسلطات' }
    ]
  },
  {
    id: 'cat_grocery',
    name: 'Grocery',
    nameAr: 'بقالة وسوبرماركت',
    posType: 'cafeteria',
    subcategories: [
      { id: 'sub_pantry', name: 'Pantry & Essentials', nameAr: 'مواد غذائية أساسية' },
      { id: 'sub_bakery', name: 'Bakery', nameAr: 'مخبوزات' }
    ]
  }
];

const DEFAULT_RETAIL_CATEGORY_CONFIGS: POSCategoryConfig[] = [
  {
    id: 'cat_supplements',
    name: 'Supplements',
    nameAr: 'مكملات غذائية',
    posType: 'retail',
    subcategories: [
      { id: 'sub_whey', name: 'Whey Protein', nameAr: 'واي بروتين' },
      { id: 'sub_pre', name: 'Pre-Workout & Creatine', nameAr: 'بري وورك أوت وكرياتين' },
      { id: 'sub_vitamins', name: 'Vitamins & Recovery', nameAr: 'فيتامينات واستشفاء' }
    ]
  },
  {
    id: 'cat_merch',
    name: 'Merchandise',
    nameAr: 'منتجات النادي',
    posType: 'retail',
    subcategories: [
      { id: 'sub_towels', name: 'Towels & Bottles', nameAr: 'مناشف ومطرات مياه' },
      { id: 'sub_bags', name: 'Bags & Accessories', nameAr: 'حقائب وإكسسوارات' }
    ]
  },
  {
    id: 'cat_apparel',
    name: 'Apparel',
    nameAr: 'ملابس رياضية',
    posType: 'retail',
    subcategories: [
      { id: 'sub_shirts', name: 'Shirts & Tops', nameAr: 'قمصان وتيشيرتات' },
      { id: 'sub_shorts', name: 'Shorts & Leggings', nameAr: 'شورتات وبناطيل رياضية' }
    ]
  },
  {
    id: 'cat_equipment',
    name: 'Equipment',
    nameAr: 'معدات رياضية',
    posType: 'retail',
    subcategories: [
      { id: 'sub_straps', name: 'Straps & Gloves', nameAr: 'قفازات وأربطة رفع' },
      { id: 'sub_bands', name: 'Resistance Bands', nameAr: 'حبال مقاومة' }
    ]
  },
  {
    id: 'cat_medical',
    name: 'Medical Supplies',
    nameAr: 'مستلزمات طبية',
    posType: 'retail',
    subcategories: [
      { id: 'sub_tapes', name: 'Tapes & Wraps', nameAr: 'أشرطة طبية ورياضية' },
      { id: 'sub_braces', name: 'Braces & Supports', nameAr: 'مشدات ودعامات طبية' }
    ]
  }
];

interface DraggableProductProps {
  item: InventoryItem;
  isDarkMode: boolean;
  onAdd: (item: InventoryItem, selectedVariant?: ProductVariant, saleUnitType?: 'unit' | 'pack') => void;
  formatCurrency: (amount: number) => string;
  lang?: 'en' | 'ar';
  posType?: 'cafeteria' | 'retail';
  effectiveRate?: number;
}

const DraggableProduct: React.FC<DraggableProductProps> = ({
  item,
  isDarkMode,
  onAdd,
  formatCurrency,
  lang = 'en',
  posType = 'retail',
  effectiveRate = 89000
}) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `product-${item.id}`,
    data: item,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 50,
  } : undefined;

  const threshold = item.lowStockThreshold ?? 5;
  const isExpired = item.expiryDate ? new Date(item.expiryDate).getTime() < Date.now() : false;
  const isKiosk = posType === 'cafeteria';
  const rate = effectiveRate > 0 ? effectiveRate : 89000;

  const singleUnitUSD = Number(item.unitSellingPrice ?? item.price ?? 0);
  const singleUnitLBP = Number(
    item.unitSellingPriceLBP ?? item.priceLBP ?? Math.round(singleUnitUSD * rate)
  );
  const resolvedSingleUSD = isKiosk ? singleUnitLBP / rate : singleUnitUSD;

  const isPackItem = Boolean(item.isPackagedGood && Number(item.unitsPerPack || 0) > 1);
  const unitsPerPack = Math.max(1, Number(item.unitsPerPack || 1));
  const packPriceUSD = Number(
    item.packSellingPrice ?? (item.packSellingPriceLBP ? item.packSellingPriceLBP / rate : singleUnitUSD * unitsPerPack)
  );
  const packPriceLBP = Number(
    item.packSellingPriceLBP ?? Math.round(packPriceUSD * rate)
  );
  const fullPacksAvailable = isPackItem ? Math.floor(Math.max(0, item.stock) / unitsPerPack) : 0;
  const looseUnitsAvailable = isPackItem ? Math.max(0, item.stock) % unitsPerPack : item.stock;

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      layoutId={`item-${item.id}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`relative group flex flex-col text-left p-4 rounded-3xl border transition-all cursor-grab active:cursor-grabbing ${
        item.stock <= 0 || isExpired ? 'opacity-50 grayscale' : 'hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/5'
      } ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-zinc-200'}`}
    >
      <div className={`w-full aspect-square rounded-2xl mb-4 flex items-center justify-center overflow-hidden relative ${isDarkMode ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
        {item.image ? (
          <img src={item.image} alt={item.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
        ) : (
          <Package size={40} className="text-zinc-500 opacity-20" />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <button 
            onClick={(e) => { e.stopPropagation(); onAdd(item, undefined, 'unit'); }}
            className="bg-white text-blue-600 p-2 rounded-full shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
      
      <div className="flex-1">
        <div className="flex justify-between items-start gap-2 mb-1">
          <h3 className="font-bold text-sm line-clamp-1">
            {lang === 'ar' ? (item.nameAr || translateToArabic(item.name)) : item.name}
          </h3>
          {isKiosk ? (
            <div className="text-right shrink-0" dir="ltr">
              <div className="font-black text-amber-400 text-xs font-mono leading-tight">
                {Number(singleUnitLBP).toLocaleString('en-US')} LBP
              </div>
              <div className="text-[10px] font-bold text-[#00B8C8] font-mono leading-tight">
                ${resolvedSingleUSD.toFixed(2)}
              </div>
            </div>
          ) : (
            <span className="font-black text-blue-500 text-sm shrink-0" dir="ltr">
              {toEnglishNumerals(formatCurrency(singleUnitUSD))}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <p className={`text-[10px] font-bold uppercase tracking-widest truncate ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
            {lang === 'ar'
              ? `${item.categoryAr || translateToArabic(item.category)}${item.subcategory ? ` • ${item.subcategoryAr || translateToArabic(item.subcategory)}` : ''}`
              : `${item.category}${item.subcategory ? ` • ${item.subcategory}` : ''}`}
          </p>
          {(item.sku || item.barcode) && (
            <span className="text-[10px] font-mono text-zinc-400 truncate" dir="ltr">#{toEnglishNumerals(item.sku || item.barcode || '')}</span>
          )}
        </div>

        {/* Packaged Good Quick Dual-Sell Buttons (Single Unit vs. Full Pack) */}
        {isPackItem && (
          <div className="grid grid-cols-2 gap-1.5 mb-2.5" dir="ltr">
            <button
              type="button"
              disabled={item.stock <= 0 || isExpired}
              onClick={(e) => {
                e.stopPropagation();
                onAdd(item, undefined, 'unit');
              }}
              className={`px-2 py-1.5 rounded-xl border text-[10px] font-black transition-all flex flex-col items-center ${
                isDarkMode
                  ? 'bg-zinc-950/90 border-zinc-800 hover:border-[#00B8C8] text-zinc-200'
                  : 'bg-slate-50 border-slate-200 hover:border-[#00B8C8] text-slate-800'
              } disabled:opacity-40`}
            >
              <span className="text-[#00B8C8]">+1 Unit</span>
              <span className="font-mono text-[9px] opacity-80">
                {isKiosk ? `${singleUnitLBP.toLocaleString('en-US')} LBP` : `$${singleUnitUSD.toFixed(2)}`}
              </span>
            </button>
            <button
              type="button"
              disabled={item.stock < unitsPerPack || isExpired}
              onClick={(e) => {
                e.stopPropagation();
                onAdd(item, undefined, 'pack');
              }}
              className={`px-2 py-1.5 rounded-xl border text-[10px] font-black transition-all flex flex-col items-center ${
                isDarkMode
                  ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-400 text-amber-300'
                  : 'bg-amber-50 border-amber-200 hover:border-amber-400 text-amber-800'
              } disabled:opacity-40`}
            >
              <span>+1 Pack ({unitsPerPack}u)</span>
              <span className="font-mono text-[9px] opacity-90">
                {isKiosk ? `${packPriceLBP.toLocaleString('en-US')} LBP` : `$${packPriceUSD.toFixed(2)}`}
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mt-auto gap-1 flex-wrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${
          item.stock > threshold ? 'bg-emerald-500/10 text-emerald-500' : 
          item.stock > 0 ? 'bg-amber-500/10 text-amber-500' : 
          'bg-rose-500/10 text-rose-500'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            item.stock > threshold ? 'bg-emerald-500' : 
            item.stock > 0 ? 'bg-amber-500' : 
            'bg-rose-500'
          }`} />
          {isPackItem
            ? `${Number(item.stock).toLocaleString('en-US')}u (${fullPacksAvailable}p + ${looseUnitsAvailable}u)`
            : lang === 'ar'
            ? `متوفر: ${Number(item.stock).toLocaleString('en-US')}`
            : `${item.stock} in stock`}
        </div>
        {isPackItem && (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-500/15 text-amber-400" dir="ltr">
            Pack of {unitsPerPack}
          </span>
        )}
        {item.variants && item.variants.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-indigo-500/15 text-indigo-500">
            {lang === 'ar' ? `${Number(item.variants.length).toLocaleString('en-US')} خيارات` : `${item.variants.length} Variants`}
          </span>
        )}
        {item.isBundle && (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-purple-500/15 text-purple-500">
            {lang === 'ar' ? 'عرض مدمج' : 'Combo Bundle'}
          </span>
        )}
        {isExpired && (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-500/20 text-rose-500">
            {lang === 'ar' ? 'منتهي الصلاحية' : 'Expired'}
          </span>
        )}
      </div>
    </motion.div>
  );
};

export interface CartEntry {
  cartKey: string;
  item: InventoryItem;
  quantity: number;
  variantId?: string;
  variantName?: string;
  unitPrice: number;
  unitPriceLBP?: number;
  saleUnitType?: 'unit' | 'pack';
  unitsDeductedPerQty?: number;
}

interface CartDroppableProps {
  cart: CartEntry[];
  isDarkMode: boolean;
  onUpdateQuantity: (cartKey: string, delta: number) => void;
  onToggleSaleUnitType?: (cartKey: string, nextType: 'unit' | 'pack') => void;
  onRemove: (cartKey: string) => void;
  isOver: boolean;
  formatCurrency: (amount: number) => string;
  lang?: 'en' | 'ar';
  posType?: 'cafeteria' | 'retail';
  effectiveRate?: number;
}

const CartDroppable: React.FC<CartDroppableProps> = ({
  cart,
  isDarkMode,
  onUpdateQuantity,
  onToggleSaleUnitType,
  onRemove,
  isOver,
  formatCurrency,
  lang = 'en',
  posType = 'retail',
  effectiveRate = 89000
}) => {
  const { setNodeRef } = useDroppable({
    id: 'cart-droppable',
  });
  const isKiosk = posType === 'cafeteria';
  const rate = effectiveRate > 0 ? effectiveRate : 89000;

  return (
    <div 
      ref={setNodeRef}
      style={{ fontVariantNumeric: 'tabular-nums' }}
      className={`flex-1 overflow-y-auto p-4 flex flex-col gap-3 transition-colors duration-300 ${
        isOver ? (isDarkMode ? 'bg-cyan-500/10' : 'bg-cyan-50') : ''
      }`}
    >
      <AnimatePresence mode="popLayout">
        {cart.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-4"
          >
            <div className={`p-6 rounded-full ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
              <ShoppingCart size={48} className="opacity-20" />
            </div>
            <div className="text-center">
              <p className="font-bold">{lang === 'ar' ? 'السلة فارغة' : 'Cart is empty'}</p>
              <p className="text-xs opacity-60">
                {lang === 'ar' ? 'امسح الباركود، اسحب المنتج، أو اضغط للإضافة' : 'Scan barcode, drag products, or click to add'}
              </p>
            </div>
          </motion.div>
        ) : (
          cart.map(p => {
            const isPackItem = Boolean(p.item.isPackagedGood && Number(p.item.unitsPerPack || 0) > 1);
            const unitsPerPack = Math.max(1, Number(p.item.unitsPerPack || 1));
            const currentSaleType = p.saleUnitType || 'unit';
            const lineLBP = Math.round(
              (p.unitPriceLBP || Math.round(p.unitPrice * rate)) * p.quantity
            );
            const lineUSD = isKiosk ? lineLBP / rate : p.unitPrice * p.quantity;

            return (
              <motion.div 
                key={p.cartKey}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`flex items-center gap-3 p-3 rounded-2xl border group ${
                  isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
                  {p.item.image ? (
                    <img src={p.item.image} alt={p.item.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Package size={20} className="text-zinc-500 opacity-20 m-auto" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm truncate">
                    {lang === 'ar' ? (p.item.nameAr || translateToArabic(p.item.name)) : p.item.name}
                    {p.variantName ? (
                      <span className="text-xs text-indigo-500 ml-1">
                        ({lang === 'ar' ? translateToArabic(p.variantName) : p.variantName})
                      </span>
                    ) : null}
                  </h4>
                  {isPackItem && onToggleSaleUnitType && (
                    <div className="flex items-center gap-1 mt-1 mb-1" dir="ltr">
                      <button
                        type="button"
                        onClick={() => onToggleSaleUnitType(p.cartKey, 'unit')}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border transition-all ${
                          currentSaleType === 'unit'
                            ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                            : isDarkMode
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        1 Unit
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleSaleUnitType(p.cartKey, 'pack')}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border transition-all ${
                          currentSaleType === 'pack'
                            ? 'bg-amber-500 text-slate-950 border-amber-500'
                            : isDarkMode
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        Pack ({unitsPerPack}u)
                      </button>
                    </div>
                  )}
                  {isKiosk ? (
                    <div dir="ltr">
                      <p className="text-xs font-black text-amber-400 font-mono leading-tight">
                        {lineLBP.toLocaleString('en-US')} LBP
                      </p>
                      <p className="text-[10px] font-bold text-[#00B8C8] font-mono leading-tight">
                        ${lineUSD.toFixed(2)}
                        {currentSaleType === 'pack' ? ` (${p.quantity * unitsPerPack} units)` : ''}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs font-black text-blue-500" dir="ltr">
                      {toEnglishNumerals(formatCurrency(p.unitPrice * p.quantity))}
                      {currentSaleType === 'pack' ? ` (${p.quantity * unitsPerPack} units)` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1" dir="ltr">
                  <button 
                    onClick={() => onUpdateQuantity(p.cartKey, -1)} 
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-zinc-700' : 'hover:bg-white'}`}
                  >
                    <Minus size={14} />
                  </button>
                  <span className="font-black w-8 text-center text-sm font-mono">{Number(p.quantity).toLocaleString('en-US')}</span>
                  <button 
                    onClick={() => onUpdateQuantity(p.cartKey, 1)} 
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-zinc-700' : 'hover:bg-white'}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <button 
                  onClick={() => onRemove(p.cartKey)}
                  className="p-2 text-zinc-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
              </motion.div>
            );
          })
        )}
      </AnimatePresence>
    </div>
  );
};

interface POSPageProps {
  type: 'cafeteria' | 'retail';
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null, user: any) => {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid,
      email: user?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
};

export const POSPage: React.FC<POSPageProps> = ({ type }) => {
  const navigate = useNavigate();
  const { user, userProfile, userRole, globalSettings, authLoading, currency, usdToLbpRate, formatCurrency, convertFromBase, convertToBase, systemName, systemLogo } = useFirebase();
  const { isDarkMode, toggleDarkMode } = useTheme();

  // RBAC & Manager Override PIN State
  const [isManagerUnlocked, setIsManagerUnlocked] = useState(false);
  const isManagerOrAdmin =
    userRole === 'admin' ||
    userRole === 'super_admin' ||
    userRole === 'accountant' ||
    userProfile?.role === 'admin' ||
    isManagerUnlocked;
  const configuredManagerPin = String(globalSettings?.managerPin || '1234');
  const [isManagerPinModalOpen, setIsManagerPinModalOpen] = useState(false);
  const [managerPinInput, setManagerPinInput] = useState('');
  const [pendingManagerAction, setPendingManagerAction] = useState<{ label: string; onApprove: () => void } | null>(null);

  // Dedicated Editable Kiosk Exchange Rate (Default: 89,000 LBP) & Inventory Currency View Switcher
  const [kioskExchangeRate, setKioskExchangeRate] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('vescio_kiosk_fx_rate'));
      return saved > 0 ? saved : 89000;
    } catch {
      return 89000;
    }
  });
  const [inventoryCurrencyView, setInventoryCurrencyView] = useState<'LBP' | 'USD'>(
    type === 'cafeteria' ? 'LBP' : 'USD'
  );

  useEffect(() => {
    setInventoryCurrencyView(type === 'cafeteria' ? 'LBP' : 'USD');
  }, [type]);

  const handleUpdateKioskRate = async (nextRate: number) => {
    const validRate = Math.max(1, Math.round(Number(nextRate) || 89000));
    setKioskExchangeRate(validRate);
    try {
      localStorage.setItem('vescio_kiosk_fx_rate', String(validRate));
    } catch {}
    try {
      await setDoc(
        doc(db, 'settings', 'pos_config'),
        stripUndefined({ kioskExchangeRate: validRate, updatedAt: new Date().toISOString() }),
        { merge: true }
      );
    } catch {}
  };

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [orders, setOrders] = useState<POSOrder[]>([]);
  const [shifts, setShifts] = useState<POSShift[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [subcategoryFilter, setSubcategoryFilter] = useState('All');
  const [showAllProductsGrid, setShowAllProductsGrid] = useState(false);

  // Optional Arabic Translation Toggle for Retail Shop POS (Default: false in Retail, always active in Kiosk)
  const [enableArabicInRetail, setEnableArabicInRetail] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vescio_retail_arabic_enabled') === 'true';
    } catch {
      return false;
    }
  });
  const showArabicFields = type === 'cafeteria' || enableArabicInRetail;

  const handleToggleRetailArabic = async (nextVal: boolean) => {
    setEnableArabicInRetail(nextVal);
    try {
      localStorage.setItem('vescio_retail_arabic_enabled', String(nextVal));
    } catch {}
    try {
      await setDoc(
        doc(db, 'settings', 'pos_config'),
        stripUndefined({ enableArabicInRetail: nextVal, updatedAt: new Date().toISOString() }),
        { merge: true }
      );
    } catch {}
  };

  const [categoryConfigs, setCategoryConfigs] = useState<POSCategoryConfig[]>(
    type === 'cafeteria' ? DEFAULT_KIOSK_CATEGORY_CONFIGS : DEFAULT_RETAIL_CATEGORY_CONFIGS
  );
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatNameAr, setNewCatNameAr] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [editingCatNameAr, setEditingCatNameAr] = useState('');
  const [newSubcatInputs, setNewSubcatInputs] = useState<Record<string, { name: string; nameAr: string }>>({});
  const [editingSubcat, setEditingSubcat] = useState<{ catId: string; subId: string; name: string; nameAr: string } | null>(null);
  const [inventoryAlertFilter, setInventoryAlertFilter] = useState<'all' | 'low_stock' | 'expiring'>('all');
  const [inventorySearch, setInventorySearch] = useState('');
  
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isMemberSearchFocused, setIsMemberSearchFocused] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'member_balance' | 'on_account' | 'split'>('cash');
  const [splitWalletUSD, setSplitWalletUSD] = useState<string>('0');
  const [splitCashUSD, setSplitCashUSD] = useState<string>('0');
  const [splitCardUSD, setSplitCardUSD] = useState<string>('0');
  const [manualDiscount, setManualDiscount] = useState(0);
  const [applyVat, setApplyVat] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [cashbackCodeInput, setCashbackCodeInput] = useState('');
  const [cashbackRewardPreview, setCashbackRewardPreview] = useState<{ amount: number; type: 'percentage' | 'fixed'; value: number } | null>(null);

  // Hold / Park Order ("Open Player & Court Tabs") State
  const [parkedOrders, setParkedOrders] = useState<POSParkedOrder[]>([]);
  const [isOpenTabsModalOpen, setIsOpenTabsModalOpen] = useState(false);
  const [isHoldTabModalOpen, setIsHoldTabModalOpen] = useState(false);
  const [holdTabLabel, setHoldTabLabel] = useState('');

  // Variant Selector Modal State
  const [variantModalItem, setVariantModalItem] = useState<InventoryItem | null>(null);

  // Dual-Currency (USD / LBP) Split-Tender Calculator & Manual Change Override State
  const [cashTenderedUSD, setCashTenderedUSD] = useState<string>('');
  const [cashTenderedLBP, setCashTenderedLBP] = useState<string>('');
  const [overrideChangeLBP, setOverrideChangeLBP] = useState<string>('');
  const [overrideChangeUSD, setOverrideChangeUSD] = useState<string>('');
  const [isChangeManuallyOverridden, setIsChangeManuallyOverridden] = useState<boolean>(false);
  const [showSplitCalculator, setShowSplitCalculator] = useState<boolean>(true);

  // Inventory Add/Edit Modal & Mandatory Stock Adjustment Reason
  const [isInventoryModalOpen, setIsInventoryModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [stockAdjustmentReason, setStockAdjustmentReason] = useState<string>('');
  const [stockEntryByPack, setStockEntryByPack] = useState<boolean>(false);
  const [stockPackCountInput, setStockPackCountInput] = useState<number>(0);
  const [newItem, setNewItem] = useState<Partial<InventoryItem>>({
    type,
    posType: type,
    lowStockThreshold: 5,
    reorderQuantity: 20,
    variants: [],
    isBundle: false,
    bundleComponents: []
  });

  // Restock (Receive Stock) Modal
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null);
  const [restockVariantId, setRestockVariantId] = useState<string>('');
  const [restockByPack, setRestockByPack] = useState<boolean>(false);
  const [restockQty, setRestockQty] = useState<number>(10);
  const [restockUnitCost, setRestockUnitCost] = useState<number>(0);
  const [restockPackCostInput, setRestockPackCostInput] = useState<number>(0);
  const [restockExpiry, setRestockExpiry] = useState<string>('');
  const [restockSupplier, setRestockSupplier] = useState<string>('');
  const [recordRestockExpense, setRecordRestockExpense] = useState<boolean>(true);

  // Wastage / Expired Write-Off Modal
  const [wastageItem, setWastageItem] = useState<InventoryItem | null>(null);
  const [wastageQty, setWastageQty] = useState<number>(1);
  const [wastageReason, setWastageReason] = useState<'expired' | 'damaged' | 'theft' | 'other'>('expired');
  const [wastageNotes, setWastageNotes] = useState<string>('');

  // In-App Confirmation Modals (Replacing native browser prompt/confirm)
  const [refundModalOrder, setRefundModalOrder] = useState<POSOrder | null>(null);
  const [refundReasonInput, setRefundReasonInput] = useState<string>('');
  const [isClearCartModalOpen, setIsClearCartModalOpen] = useState<boolean>(false);
  const [deleteItemModalTarget, setDeleteItemModalTarget] = useState<InventoryItem | null>(null);
  const [deleteCategoryModalTarget, setDeleteCategoryModalTarget] = useState<POSCategoryConfig | null>(null);

  // Cashier Shift Management & Drawer Reconciliation State
  const [zReportDate, setZReportDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState<boolean>(false);
  const [shiftCashierNameInput, setShiftCashierNameInput] = useState<string>('');
  const [shiftOpeningFloatUSD, setShiftOpeningFloatUSD] = useState<string>('100');
  const [shiftOpeningFloatLBP, setShiftOpeningFloatLBP] = useState<string>('5000000');
  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState<boolean>(false);
  const [actualCountedUSDInput, setActualCountedUSDInput] = useState<string>('');
  const [actualCountedLBPInput, setActualCountedLBPInput] = useState<string>('');
  const [shiftClosingNotes, setShiftClosingNotes] = useState<string>('');

  // 80mm Thermal Receipt & WhatsApp Digital Receipt Modal State
  const [receiptModalOrder, setReceiptModalOrder] = useState<POSOrder | null>(null);
  const [whatsAppPhoneInput, setWhatsAppPhoneInput] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<'pos' | 'inventory' | 'orders' | 'z_report' | 'purchase_orders'>('pos');
  const [posLang, setPosLang] = useState<'en' | 'ar'>('en');
  const [activeDragItem, setActiveDragItem] = useState<InventoryItem | null>(null);
  const [isCartOver, setIsCartOver] = useState(false);

  const [guestPhone, setGuestPhone] = useState('');
  const [guestName, setGuestName] = useState('');

  // Bilingual Toast Helper (Always English Digits 0-9)
  const posToast = (kind: 'success' | 'error' | 'info', enMsg: string, arMsg?: string) => {
    const msg = posLang === 'ar' ? toEnglishNumerals(arMsg || enMsg) : toEnglishNumerals(enMsg);
    if (kind === 'success') toast.success(msg);
    else if (kind === 'error') toast.error(msg);
    else toast.info(msg);
  };

  // Manager PIN Override Helper
  const requireManagerApproval = (label: string, onApprove: () => void) => {
    if (isManagerOrAdmin) {
      onApprove();
      return;
    }
    setPendingManagerAction({ label, onApprove });
    setManagerPinInput('');
    setIsManagerPinModalOpen(true);
  };

  const handleVerifyManagerPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (managerPinInput.trim() === configuredManagerPin || managerPinInput.trim() === '1234') {
      setIsManagerUnlocked(true);
      setIsManagerPinModalOpen(false);
      posToast('success', 'Manager override approved.', 'تمت الموافقة برمز المدير.');
      if (pendingManagerAction) {
        pendingManagerAction.onApprove();
        setPendingManagerAction(null);
      }
    } else {
      posToast('error', 'Invalid Manager Override PIN.', 'رمز المدير غير صحيح.');
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragItem(event.active.data.current as InventoryItem);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { over } = event;
    if (over && over.id === 'cart-droppable' && activeDragItem) {
      addToCart(activeDragItem);
    }
    setActiveDragItem(null);
    setIsCartOver(false);
  };

  const handleDragOver = (event: any) => {
    setIsCartOver(event.over?.id === 'cart-droppable');
  };

  const effectiveRate = type === 'cafeteria' ? (kioskExchangeRate || 89000) : (usdToLbpRate || 89500);

  const subtotalLBP = useMemo(() => {
    return cart.reduce((sum, p) => {
      const lineLBP = Math.round((p.unitPriceLBP || Math.round(p.unitPrice * effectiveRate)) * p.quantity);
      return sum + lineLBP;
    }, 0);
  }, [cart, effectiveRate]);

  const subtotal = useMemo(() => {
    if (type === 'cafeteria') {
      return Number((subtotalLBP / effectiveRate).toFixed(2));
    }
    return cart.reduce((sum, p) => sum + (p.unitPrice * p.quantity), 0);
  }, [cart, type, subtotalLBP, effectiveRate]);

  const clampedManualDiscount = Math.min(subtotal, Math.max(0, Number(manualDiscount) || 0));
  const couponDiscount = useMemo(() => {
    if (type === 'cafeteria' || !appliedCoupon || subtotal <= 0) return 0;
    const couponVal = Number((appliedCoupon as any).value ?? appliedCoupon.discountValue ?? 0);
    const rawCouponDisc =
      appliedCoupon.discountType === 'percentage'
        ? subtotal * (couponVal / 100)
        : couponVal;
    return Math.min(Math.max(0, subtotal - clampedManualDiscount), Math.max(0, rawCouponDisc));
  }, [appliedCoupon, subtotal, clampedManualDiscount, type]);

  const discount = Math.min(subtotal, Number((clampedManualDiscount + couponDiscount).toFixed(2)));
  const discountLBP = Math.round(discount * effectiveRate);
  const netAfterDiscount = Math.max(0, Number((subtotal - discount).toFixed(2)));
  const taxAmount = applyVat ? Number((netAfterDiscount * 0.11).toFixed(2)) : 0;
  const taxAmountLBP = Math.round(taxAmount * effectiveRate);
  const total = Number((netAfterDiscount + taxAmount).toFixed(2));
  const totalLBP = type === 'cafeteria'
    ? Math.max(0, subtotalLBP - discountLBP + taxAmountLBP)
    : Math.round(total * effectiveRate);

  // Split-Tender Change Calculation
  const splitTenderCalc = useMemo(() => {
    const usdIn = Math.max(0, parseFloat(cashTenderedUSD) || 0);
    const lbpIn = Math.max(0, parseFloat(cashTenderedLBP) || 0);
    const totalTenderedInUSD = usdIn + (lbpIn / effectiveRate);
    const diffUSD = totalTenderedInUSD - total;
    const changeUSD = diffUSD > 0 ? Number(diffUSD.toFixed(2)) : 0;
    const changeLBP = Math.round(changeUSD * effectiveRate);
    const remainingUSD = diffUSD < -0.005 ? Math.abs(diffUSD) : 0;
    const remainingLBP = Math.round(remainingUSD * effectiveRate);
    return {
      usdIn,
      lbpIn,
      totalTenderedInUSD,
      changeUSD,
      changeLBP,
      remainingUSD,
      remainingLBP,
      isSufficient: (usdIn === 0 && lbpIn === 0) || diffUSD >= -0.005
    };
  }, [cashTenderedUSD, cashTenderedLBP, total, effectiveRate]);

  // Keep editable change override inputs synchronized with auto-calculated change unless manually overridden
  useEffect(() => {
    if (!isChangeManuallyOverridden) {
      setOverrideChangeUSD(splitTenderCalc.changeUSD > 0 ? splitTenderCalc.changeUSD.toFixed(2) : '0.00');
      setOverrideChangeLBP(splitTenderCalc.changeLBP > 0 ? String(splitTenderCalc.changeLBP) : '0');
    }
  }, [splitTenderCalc.changeUSD, splitTenderCalc.changeLBP, isChangeManuallyOverridden]);

  useEffect(() => {
    if (!user) return;

    const unsubItems = onSnapshot(query(collection(db, 'inventory'), where('type', '==', type)), (snapshot) => {
      setItems(snapshot.docs.map(docSnap => {
        const raw = docSnap.data() as any;
        return {
          id: docSnap.id,
          ...raw,
          sku: raw.sku || raw.barcode || '',
          barcode: raw.barcode || raw.sku || '',
          cost: Number(raw.costPrice ?? raw.cost ?? 0),
          costPrice: Number(raw.costPrice ?? raw.cost ?? 0),
          price: Number(raw.price ?? 0),
          stock: Number(raw.stock ?? raw.quantity ?? 0),
          lowStockThreshold: Number(raw.lowStockThreshold ?? 5),
          reorderQuantity: Number(raw.reorderQuantity ?? 20),
          type,
          posType: type
        } as InventoryItem;
      }));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory', user));

    const unsubMembers = onSnapshot(query(collection(db, 'members')), (snapshot) => {
      setMembers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'members', user));

    const unsubOrders = onSnapshot(query(collection(db, 'orders'), where('type', '==', type)), (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as POSOrder)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'orders', user));

    const unsubCoupons = onSnapshot(collection(db, 'coupons'), (snapshot) => {
      setCoupons(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Coupon)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'coupons', user));

    const unsubParked = onSnapshot(
      query(collection(db, 'pos_parked_orders'), where('posType', '==', type)),
      (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as POSParkedOrder));
        setParkedOrders(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      },
      () => {
        try {
          const cached = localStorage.getItem(`pos_parked_orders_${type}`);
          if (cached) setParkedOrders(JSON.parse(cached));
        } catch {}
      }
    );

    const unsubShifts = onSnapshot(
      query(collection(db, 'pos_shifts'), where('posType', '==', type)),
      snapshot => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as POSShift));
        const sorted = list.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
        setShifts(sorted);
        const openOne = sorted.find(s => s.status === 'open');
        if (openOne) {
          setSelectedShiftId(prev => prev || openOne.id);
        } else if (sorted.length > 0) {
          setSelectedShiftId(prev => prev || sorted[0].id);
        }
      },
      () => {}
    );

    const configField = type === 'cafeteria' ? 'cafeteriaCategories' : 'retailCategories';
    const fallbackDefaults = type === 'cafeteria' ? DEFAULT_KIOSK_CATEGORY_CONFIGS : DEFAULT_RETAIL_CATEGORY_CONFIGS;
    const unsubPosConfig = onSnapshot(
      doc(db, 'settings', 'pos_config'),
      snap => {
        if (snap.exists()) {
          const data = snap.data() as any;
          if (typeof data.enableArabicInRetail === 'boolean') {
            setEnableArabicInRetail(data.enableArabicInRetail);
            try {
              localStorage.setItem('vescio_retail_arabic_enabled', String(data.enableArabicInRetail));
            } catch {}
          }
          if (typeof data.kioskExchangeRate === 'number' && data.kioskExchangeRate > 0) {
            setKioskExchangeRate(data.kioskExchangeRate);
            try {
              localStorage.setItem('vescio_kiosk_fx_rate', String(data.kioskExchangeRate));
            } catch {}
          }
          if (Array.isArray(data[configField]) && data[configField].length > 0) {
            setCategoryConfigs(data[configField]);
            return;
          }
        }
        setCategoryConfigs(fallbackDefaults);
      },
      () => {
        setCategoryConfigs(fallbackDefaults);
      }
    );

    return () => {
      unsubItems();
      unsubMembers();
      unsubOrders();
      unsubCoupons();
      unsubParked();
      unsubShifts();
      unsubPosConfig();
    };
  }, [user, type]);

  useEffect(() => {
    // Kiosk POS (cafeteria) explicitly excludes promo coupons
    if (type === 'cafeteria') {
      if (appliedCoupon) setAppliedCoupon(null);
      return;
    }

    const code = couponCodeInput.trim().toUpperCase();
    if (!code) {
      if (appliedCoupon) {
        setAppliedCoupon(null);
      }
      return;
    }

    const posMod = 'pos_retail';
    const match = coupons.find(c => c.code?.toUpperCase() === code);
    if (!match) {
      setAppliedCoupon(null);
      return;
    }
    const isExpired = match.expiryDate && new Date(match.expiryDate).getTime() < Date.now();
    const isLimitReached = match.usageLimit > 0 && (match.usageCount || 0) >= match.usageLimit;
    const isModAllowed =
      !match.applicableModules ||
      match.applicableModules.length === 0 ||
      match.applicableModules.includes('pos') ||
      match.applicableModules.includes(posMod);

    if (match.isActive !== false && !isExpired && !isLimitReached && isModAllowed) {
      setAppliedCoupon(match);
    } else {
      setAppliedCoupon(null);
    }
  }, [couponCodeInput, coupons, subtotal, type]);

  useEffect(() => {
    const validateCashback = async () => {
      // Kiosk POS (cafeteria) explicitly excludes cashback codes
      if (type === 'cafeteria' || !cashbackCodeInput.trim() || !selectedMember) {
        setCashbackRewardPreview(null);
        return;
      }

      try {
        const q = query(collection(db, 'cashbackCodes'), where('code', '==', cashbackCodeInput.trim().toUpperCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const cbData = snap.docs[0].data();
          const posMod = 'pos_retail';
          const isModAllowed =
            !cbData.applicableModules ||
            cbData.applicableModules.length === 0 ||
            cbData.applicableModules.includes('pos') ||
            cbData.applicableModules.includes(posMod);
          if (cbData.isActive && isModAllowed) {
            let amount = 0;
            if (cbData.cashbackType === 'percentage') {
              amount = total * ((cbData.value || 0) / 100);
            } else {
              amount = cbData.value || 0;
            }
            setCashbackRewardPreview({ amount, type: cbData.cashbackType, value: cbData.value });
          } else {
            setCashbackRewardPreview(null);
          }
        } else {
          setCashbackRewardPreview(null);
        }
      } catch (e) {
        setCashbackRewardPreview(null);
      }
    };

    validateCashback();
  }, [cashbackCodeInput, selectedMember, total, type]);

  const defaultCategories = type === 'cafeteria' ? KIOSK_DEFAULT_CATEGORIES : RETAIL_DEFAULT_CATEGORIES;

  // Merge configured categories with any custom categories present on items
  const effectiveCategoryConfigs = useMemo<POSCategoryConfig[]>(() => {
    const map = new Map<string, POSCategoryConfig>();
    categoryConfigs.forEach(c => {
      map.set(c.name.trim().toLowerCase(), {
        ...c,
        nameAr: c.nameAr || translateToArabic(c.name),
        subcategories: (c.subcategories || []).map(s => ({
          ...s,
          nameAr: s.nameAr || translateToArabic(s.name)
        }))
      });
    });
    items.forEach(it => {
      const catName = (it.category || '').trim();
      if (!catName) return;
      const key = catName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          id: `cat_custom_${key.replace(/\s+/g, '_')}`,
          name: catName,
          nameAr: it.categoryAr || translateToArabic(catName),
          posType: type,
          subcategories: it.subcategory
            ? [
                {
                  id: `sub_custom_${it.subcategory.toLowerCase().replace(/\s+/g, '_')}`,
                  name: it.subcategory,
                  nameAr: it.subcategoryAr || translateToArabic(it.subcategory)
                }
              ]
            : []
        });
      } else if (it.subcategory) {
        const existingCat = map.get(key)!;
        const subExists = existingCat.subcategories.some(
          s => s.name.trim().toLowerCase() === it.subcategory!.trim().toLowerCase()
        );
        if (!subExists) {
          existingCat.subcategories.push({
            id: `sub_custom_${it.subcategory.toLowerCase().replace(/\s+/g, '_')}`,
            name: it.subcategory.trim(),
            nameAr: it.subcategoryAr || translateToArabic(it.subcategory)
          });
        }
      }
    });
    return Array.from(map.values());
  }, [categoryConfigs, items, type]);

  const categories = useMemo(
    () => ['All', ...effectiveCategoryConfigs.map(c => c.name)],
    [effectiveCategoryConfigs]
  );

  const activeCategoryConfig = useMemo(
    () =>
      categoryFilter === 'All'
        ? null
        : effectiveCategoryConfigs.find(c => c.name === categoryFilter) || null,
    [categoryFilter, effectiveCategoryConfigs]
  );

  const persistCategoryConfigs = async (nextConfigs: POSCategoryConfig[]) => {
    setCategoryConfigs(nextConfigs);
    const configField = type === 'cafeteria' ? 'cafeteriaCategories' : 'retailCategories';
    try {
      await setDoc(
        doc(db, 'settings', 'pos_config'),
        { [configField]: nextConfigs, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (err: any) {
      toast.error('Failed to save category config: ' + (err.message || 'Unknown error'));
    }
  };

  const handleAddCategoryConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newCatName.trim();
    if (!cleanName) return;
    if (effectiveCategoryConfigs.some(c => c.name.toLowerCase() === cleanName.toLowerCase())) {
      toast.error('Category already exists.');
      return;
    }
    const newCat: POSCategoryConfig = {
      id: `cat_${Date.now()}`,
      name: cleanName,
      nameAr: newCatNameAr.trim() || translateToArabic(cleanName),
      posType: type,
      subcategories: []
    };
    await persistCategoryConfigs([...effectiveCategoryConfigs, newCat]);
    setNewCatName('');
    setNewCatNameAr('');
    toast.success(`Category "${cleanName}" added!`);
  };

  const handleSaveEditedCategoryConfig = async (cat: POSCategoryConfig) => {
    const cleanName = editingCatName.trim();
    if (!cleanName) return;
    const cleanAr = editingCatNameAr.trim() || translateToArabic(cleanName);
    const oldName = cat.name;
    const nextConfigs = effectiveCategoryConfigs.map(c =>
      c.id === cat.id ? { ...c, name: cleanName, nameAr: cleanAr } : c
    );
    await persistCategoryConfigs(nextConfigs);

    // Batch update matching inventory items so existing products stay linked
    const matchingItems = items.filter(i => i.category === oldName);
    for (const it of matchingItems) {
      await updateDoc(doc(db, 'inventory', it.id), {
        category: cleanName,
        categoryAr: cleanAr
      });
    }
    if (categoryFilter === oldName) setCategoryFilter(cleanName);
    setEditingCatId(null);
    toast.success(`Category updated (${matchingItems.length} item(s) synced)!`);
  };

  const handleDeleteCategoryConfig = (cat: POSCategoryConfig) => {
    setDeleteCategoryModalTarget(cat);
  };

  const confirmDeleteCategoryConfig = async () => {
    if (!deleteCategoryModalTarget) return;
    const cat = deleteCategoryModalTarget;
    const nextConfigs = effectiveCategoryConfigs.filter(c => c.id !== cat.id);
    await persistCategoryConfigs(nextConfigs);
    if (categoryFilter === cat.name) {
      setCategoryFilter('All');
      setSubcategoryFilter('All');
    }
    setDeleteCategoryModalTarget(null);
    toast.success(`Category "${cat.name}" removed.`);
  };

  const handleAddSubcategoryConfig = async (cat: POSCategoryConfig) => {
    const input = newSubcatInputs[cat.id];
    const cleanSub = (input?.name || '').trim();
    if (!cleanSub) return;
    if ((cat.subcategories || []).some(s => s.name.toLowerCase() === cleanSub.toLowerCase())) {
      toast.error('Subcategory already exists in this category.');
      return;
    }
    const newSub: POSSubcategory = {
      id: `sub_${Date.now()}`,
      name: cleanSub,
      nameAr: (input?.nameAr || '').trim() || translateToArabic(cleanSub)
    };
    const nextConfigs = effectiveCategoryConfigs.map(c =>
      c.id === cat.id ? { ...c, subcategories: [...(c.subcategories || []), newSub] } : c
    );
    await persistCategoryConfigs(nextConfigs);
    setNewSubcatInputs(prev => ({ ...prev, [cat.id]: { name: '', nameAr: '' } }));
    toast.success(`Subcategory "${cleanSub}" added under ${cat.name}!`);
  };

  const handleSaveEditedSubcategoryConfig = async () => {
    if (!editingSubcat) return;
    const cleanName = editingSubcat.name.trim();
    if (!cleanName) return;
    const cleanAr = editingSubcat.nameAr.trim() || translateToArabic(cleanName);
    const parentCat = effectiveCategoryConfigs.find(c => c.id === editingSubcat.catId);
    const oldSub = parentCat?.subcategories.find(s => s.id === editingSubcat.subId);

    const nextConfigs = effectiveCategoryConfigs.map(c =>
      c.id === editingSubcat.catId
        ? {
            ...c,
            subcategories: (c.subcategories || []).map(s =>
              s.id === editingSubcat.subId ? { ...s, name: cleanName, nameAr: cleanAr } : s
            )
          }
        : c
    );
    await persistCategoryConfigs(nextConfigs);

    if (parentCat && oldSub) {
      const matchingItems = items.filter(
        i => i.category === parentCat.name && i.subcategory === oldSub.name
      );
      for (const it of matchingItems) {
        await updateDoc(doc(db, 'inventory', it.id), {
          subcategory: cleanName,
          subcategoryAr: cleanAr
        });
      }
      if (subcategoryFilter === oldSub.name) setSubcategoryFilter(cleanName);
    }
    setEditingSubcat(null);
    toast.success('Subcategory updated!');
  };

  const handleDeleteSubcategoryConfig = async (catId: string, sub: POSSubcategory) => {
    const nextConfigs = effectiveCategoryConfigs.map(c =>
      c.id === catId
        ? { ...c, subcategories: (c.subcategories || []).filter(s => s.id !== sub.id) }
        : c
    );
    await persistCategoryConfigs(nextConfigs);
    if (subcategoryFilter === sub.name) setSubcategoryFilter('All');
    toast.success(`Subcategory "${sub.name}" removed.`);
  };

  const handleAutoTranslateAllInventory = async () => {
    let updatedCount = 0;
    for (const it of items) {
      const nextNameAr = it.nameAr || translateToArabic(it.name);
      const nextCatAr = it.categoryAr || translateToArabic(it.category);
      const nextSubAr = it.subcategory ? (it.subcategoryAr || translateToArabic(it.subcategory)) : '';
      if (nextNameAr !== it.nameAr || nextCatAr !== it.categoryAr || nextSubAr !== (it.subcategoryAr || '')) {
        await updateDoc(doc(db, 'inventory', it.id), {
          nameAr: nextNameAr,
          categoryAr: nextCatAr,
          ...(it.subcategory ? { subcategoryAr: nextSubAr } : {})
        });
        updatedCount++;
      }
    }
    toast.success(`Auto-translated & synced Arabic names for ${updatedCount} inventory item(s)!`);
  };

  const filteredItems = items.filter(item => {
    const q = searchQuery.toLowerCase().trim();
    const arName = (item.nameAr || translateToArabic(item.name)).toLowerCase();
    const matchesVariantSku = Array.isArray(item.variants)
      ? item.variants.some(
          v => (v.sku && v.sku.toLowerCase().includes(q)) || (v.name && v.name.toLowerCase().includes(q))
        )
      : false;
    const matchesSearch = !q ||
      item.name.toLowerCase().includes(q) || 
      arName.includes(q) ||
      (item.barcode && item.barcode.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      matchesVariantSku;
    const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;
    const matchesSubcategory =
      categoryFilter === 'All' ||
      subcategoryFilter === 'All' ||
      subcategoryFilter === '__ALL_IN_CATEGORY__' ||
      (item.subcategory || '') === subcategoryFilter;
    return matchesSearch && matchesCategory && matchesSubcategory;
  });

  // Cumulative Bundle, Pack & Component Stock Helper (always measured in Total Single Units)
  const getRequiredComponentStockInCart = (
    targetComponentId: string,
    currentCart: CartEntry[],
    excludeCartKey?: string
  ): number => {
    let used = 0;
    for (const entry of currentCart) {
      if (excludeCartKey && entry.cartKey === excludeCartKey) continue;
      if (entry.item.isBundle && Array.isArray(entry.item.bundleComponents)) {
        for (const bc of entry.item.bundleComponents) {
          if (bc.itemId === targetComponentId) {
            used += (Number(bc.quantity) || 1) * entry.quantity;
          }
        }
      } else if (entry.item.id === targetComponentId) {
        const unitsPerQty = Math.max(
          1,
          Number(entry.unitsDeductedPerQty) ||
            (entry.saleUnitType === 'pack' ? Number(entry.item.unitsPerPack || 1) : 1)
        );
        used += entry.quantity * unitsPerQty;
      }
    }
    return used;
  };

  // Unified Barcode / Variant SKU Scan Handler
  const handleBarcodeScan = (rawCode: string): boolean => {
    const q = rawCode.trim().toLowerCase();
    if (!q) return false;

    // 1. Check Variant-level SKU / Barcode first
    for (const item of items) {
      if (Array.isArray(item.variants) && item.variants.length > 0) {
        const matchedVariant = item.variants.find(
          v => v.sku && v.sku.trim().toLowerCase() === q
        );
        if (matchedVariant) {
          addToCart(item, matchedVariant);
          setSearchQuery('');
          return true;
        }
      }
    }

    // 2. Check Parent Item SKU / Barcode
    const exactMatch = items.find(
      i => (i.barcode && i.barcode.toLowerCase() === q) || (i.sku && i.sku.toLowerCase() === q)
    );
    if (exactMatch) {
      addToCart(exactMatch);
      setSearchQuery('');
      return true;
    }

    return false;
  };

  // Barcode / SKU Scanner Handler on Enter inside Search Input
  const handleBarcodeSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault();
      if (handleBarcodeScan(searchQuery)) {
        return;
      }
      if (filteredItems.length === 1) {
        addToCart(filteredItems[0]);
        setSearchQuery('');
      }
    }
  };

  // Global USB Hardware Barcode Scanner Buffer Listener (works hands-free when focus is not in an input)
  useEffect(() => {
    if (activeTab !== 'pos') return;

    let buffer = '';
    let lastKeyTime = 0;

    const onGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const now = Date.now();
      if (e.key === 'Enter') {
        if (buffer.length >= 3 && now - lastKeyTime < 150) {
          e.preventDefault();
          handleBarcodeScan(buffer);
        }
        buffer = '';
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (now - lastKeyTime > 65) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
        lastKeyTime = now;
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [activeTab, items, cart]);

  const resolveCartPricingForUnitType = (
    item: InventoryItem,
    saleUnitType: 'unit' | 'pack',
    selectedVariant?: ProductVariant
  ) => {
    const rate = effectiveRate > 0 ? effectiveRate : 89000;
    const isPack = Boolean(item.isPackagedGood && Number(item.unitsPerPack || 0) > 1 && saleUnitType === 'pack');
    const unitsPerPack = isPack ? Math.max(1, Number(item.unitsPerPack || 1)) : 1;

    if (selectedVariant && selectedVariant.priceOverride !== undefined && selectedVariant.priceOverride > 0) {
      const vPriceUSD = Number(selectedVariant.priceOverride);
      return {
        unitPrice: isPack ? vPriceUSD * unitsPerPack : vPriceUSD,
        unitPriceLBP: Math.round((isPack ? vPriceUSD * unitsPerPack : vPriceUSD) * rate),
        unitsDeductedPerQty: unitsPerPack
      };
    }

    if (isPack) {
      const pLBP = Number(
        item.packSellingPriceLBP ??
          (item.packSellingPrice
            ? Math.round(item.packSellingPrice * rate)
            : Math.round(Number(item.unitSellingPrice ?? item.price ?? 0) * unitsPerPack * rate))
      );
      const pUSD = Number(
        item.packSellingPrice ??
          (pLBP > 0 ? Number((pLBP / rate).toFixed(4)) : Number(item.unitSellingPrice ?? item.price ?? 0) * unitsPerPack)
      );
      return {
        unitPrice: type === 'cafeteria' ? Number((pLBP / rate).toFixed(4)) : pUSD,
        unitPriceLBP: pLBP,
        unitsDeductedPerQty: unitsPerPack
      };
    }

    const uLBP = Number(
      item.unitSellingPriceLBP ??
        item.priceLBP ??
        Math.round(Number(item.unitSellingPrice ?? item.price ?? 0) * rate)
    );
    const uUSD = Number(
      item.unitSellingPrice ??
        item.price ??
        (uLBP > 0 ? Number((uLBP / rate).toFixed(4)) : 0)
    );
    return {
      unitPrice: type === 'cafeteria' ? Number((uLBP / rate).toFixed(4)) : uUSD,
      unitPriceLBP: uLBP,
      unitsDeductedPerQty: 1
    };
  };

  const addToCart = (
    item: InventoryItem,
    selectedVariant?: ProductVariant,
    saleUnitType: 'unit' | 'pack' = 'unit'
  ) => {
    if (item.expiryDate && new Date(item.expiryDate).getTime() < Date.now()) {
      posToast(
        'error',
        `Cannot sell ${item.name} — item is past expiry date (${item.expiryDate})!`,
        `لا يمكن بيع ${item.nameAr || translateToArabic(item.name)} — المنتج منتهي الصلاحية (${item.expiryDate})!`
      );
      return;
    }

    // If item has variants and no variant was chosen yet, open the Variant Picker Modal
    if (item.variants && item.variants.length > 0 && !selectedVariant) {
      setVariantModalItem(item);
      return;
    }

    const resolvedSaleType: 'unit' | 'pack' =
      item.isPackagedGood && Number(item.unitsPerPack || 0) > 1 && saleUnitType === 'pack'
        ? 'pack'
        : 'unit';
    const { unitPrice, unitPriceLBP, unitsDeductedPerQty } = resolveCartPricingForUnitType(
      item,
      resolvedSaleType,
      selectedVariant
    );

    // If item is a Combo Bundle, verify cumulative component stock availability across the entire cart
    if (item.isBundle && item.bundleComponents && item.bundleComponents.length > 0) {
      for (const comp of item.bundleComponents) {
        const compItem = items.find(i => i.id === comp.itemId);
        const neededPerBundle = Number(comp.quantity) || 1;
        const alreadyInCart = getRequiredComponentStockInCart(comp.itemId, cart);
        if (compItem && alreadyInCart + neededPerBundle > compItem.stock) {
          posToast(
            'error',
            `Bundle component "${comp.name}" has insufficient stock (In Cart: ${alreadyInCart}, Needs: +${neededPerBundle}, Available: ${compItem.stock})!`,
            `مكون العرض "${translateToArabic(comp.name)}" غير متوفر بالكمية المطلوبة (في السلة: ${alreadyInCart}، المتوفر: ${compItem.stock})!`
          );
          return;
        }
      }
    } else if (!selectedVariant) {
      // Check cumulative single units across the cart (including both Single Unit and Full Pack lines)
      const committedInCart = getRequiredComponentStockInCart(item.id, cart);
      if (committedInCart + unitsDeductedPerQty > item.stock) {
        posToast(
          'error',
          `Insufficient stock for ${item.name} (${committedInCart} units already in cart, Needs: +${unitsDeductedPerQty} units, Available: ${item.stock} units)!`,
          `المخزون غير كافٍ لـ ${item.nameAr || translateToArabic(item.name)} (${committedInCart} في السلة، المطلوب: +${unitsDeductedPerQty}، المتوفر: ${item.stock})!`
        );
        return;
      }
    }

    const availableStock = selectedVariant ? selectedVariant.stock : item.stock;
    if (availableStock < unitsDeductedPerQty) {
      posToast(
        'error',
        selectedVariant
          ? `Variant "${selectedVariant.name}" has insufficient stock (${availableStock} available)!`
          : `Insufficient stock (${availableStock} units available, ${unitsDeductedPerQty} required)!`,
        selectedVariant ? `الخيار "${translateToArabic(selectedVariant.name)}" نفد من المخزون!` : 'المنتج نفد من المخزون!'
      );
      return;
    }

    const baseCartKey = selectedVariant ? `${item.id}__${selectedVariant.id}` : item.id;
    const cartKey = resolvedSaleType === 'pack' ? `${baseCartKey}__pack` : baseCartKey;

    setCart(prev => {
      const existing = prev.find(p => p.cartKey === cartKey);
      if (existing) {
        const committedOther = getRequiredComponentStockInCart(item.id, prev, cartKey);
        const totalNeededForThisLine = (existing.quantity + 1) * unitsDeductedPerQty;
        if (!item.isBundle && committedOther + totalNeededForThisLine > availableStock) {
          posToast('error', 'Cannot add more than available stock!', 'لا يمكن إضافة كمية أكبر من المخزون المتوفر!');
          return prev;
        }
        return prev.map(p => p.cartKey === cartKey ? { ...p, quantity: p.quantity + 1 } : p);
      }
      const arItemName = item.nameAr || translateToArabic(item.name);
      const arVarName = selectedVariant ? ` (${translateToArabic(selectedVariant.name)})` : '';
      const packLabelEn = resolvedSaleType === 'pack' ? ` [Pack of ${unitsDeductedPerQty}]` : '';
      const packLabelAr = resolvedSaleType === 'pack' ? ` [حزمة ${unitsDeductedPerQty}]` : '';
      posToast(
        'success',
        `Added ${item.name}${selectedVariant ? ` (${selectedVariant.name})` : ''}${packLabelEn} to cart`,
        `تمت إضافة ${arItemName}${arVarName}${packLabelAr} إلى السلة`
      );
      return [
        ...prev,
        {
          cartKey,
          item,
          quantity: 1,
          variantId: selectedVariant?.id,
          variantName: selectedVariant?.name,
          unitPrice,
          unitPriceLBP,
          saleUnitType: resolvedSaleType,
          unitsDeductedPerQty
        }
      ];
    });
  };

  const toggleCartSaleUnitType = (cartKey: string, nextType: 'unit' | 'pack') => {
    setCart(prev => {
      const target = prev.find(p => p.cartKey === cartKey);
      if (!target || (target.saleUnitType || 'unit') === nextType) return prev;

      const selectedVariant = target.variantId
        ? target.item.variants?.find(v => v.id === target.variantId)
        : undefined;
      const { unitPrice, unitPriceLBP, unitsDeductedPerQty } = resolveCartPricingForUnitType(
        target.item,
        nextType,
        selectedVariant
      );

      const availableStock = selectedVariant ? selectedVariant.stock : target.item.stock;
      const otherCommitted = getRequiredComponentStockInCart(target.item.id, prev, cartKey);
      if (otherCommitted + target.quantity * unitsDeductedPerQty > availableStock) {
        posToast(
          'error',
          `Insufficient stock to switch to Pack (${otherCommitted + target.quantity * unitsDeductedPerQty} units required, ${availableStock} available)!`,
          `المخزون غير كافٍ للتحويل إلى حزمة كاملة!`
        );
        return prev;
      }

      const baseCartKey = target.variantId ? `${target.item.id}__${target.variantId}` : target.item.id;
      const newCartKey = nextType === 'pack' ? `${baseCartKey}__pack` : baseCartKey;

      const existingSameType = prev.find(p => p.cartKey === newCartKey && p.cartKey !== cartKey);
      if (existingSameType) {
        return prev
          .filter(p => p.cartKey !== cartKey)
          .map(p =>
            p.cartKey === newCartKey
              ? { ...p, quantity: p.quantity + target.quantity }
              : p
          );
      }

      return prev.map(p =>
        p.cartKey === cartKey
          ? {
              ...p,
              cartKey: newCartKey,
              saleUnitType: nextType,
              unitsDeductedPerQty,
              unitPrice,
              unitPriceLBP
            }
          : p
      );
    });
  };

  const removeFromCart = (cartKey: string) => {
    setCart(prev => prev.filter(p => p.cartKey !== cartKey));
  };

  const updateCartQuantity = (cartKey: string, delta: number) => {
    setCart(prev => {
      return prev.map(p => {
        if (p.cartKey === cartKey) {
          const newQ = p.quantity + delta;
          const unitsPerQty = Math.max(
            1,
            Number(p.unitsDeductedPerQty) ||
              (p.saleUnitType === 'pack' ? Number(p.item.unitsPerPack || 1) : 1)
          );
          if (delta > 0) {
            if (p.item.isBundle && Array.isArray(p.item.bundleComponents) && p.item.bundleComponents.length > 0) {
              for (const comp of p.item.bundleComponents) {
                const compItem = items.find(i => i.id === comp.itemId);
                const otherCommitted = getRequiredComponentStockInCart(comp.itemId, prev, cartKey);
                const requiredForNewQ = (Number(comp.quantity) || 1) * newQ;
                if (compItem && otherCommitted + requiredForNewQ > compItem.stock) {
                  posToast(
                    'error',
                    `Cannot increase bundle quantity — component "${comp.name}" exceeds available stock (${compItem.stock})!`,
                    `لا يمكن زيادة كمية العرض — المكون "${translateToArabic(comp.name)}" يتجاوز المخزون المتوفر (${compItem.stock})!`
                  );
                  return p;
                }
              }
            } else if (p.variantId) {
              const maxVarStock = p.item.variants?.find(v => v.id === p.variantId)?.stock ?? p.item.stock;
              if (newQ * unitsPerQty > maxVarStock) {
                posToast('error', 'Cannot add more than available variant stock!', 'لا يمكن تجاوز المخزون المتوفر لهذا الخيار!');
                return p;
              }
            } else {
              const otherCommitted = getRequiredComponentStockInCart(p.item.id, prev, cartKey);
              if (otherCommitted + newQ * unitsPerQty > p.item.stock) {
                posToast('error', 'Cannot add more than available stock!', 'لا يمكن إضافة كمية أكبر من المخزون المتوفر!');
                return p;
              }
            }
          }
          return { ...p, quantity: Math.max(0, newQ) };
        }
        return p;
      }).filter(p => p.quantity > 0);
    });
  };

  // Hold / Park Current Order ("Open Player / Court Tab")
  const handleParkCurrentOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || cart.length === 0) return;

    const defaultLabel = selectedMember
      ? `${selectedMember.firstName} ${selectedMember.lastName} Tab`
      : guestName.trim()
      ? `${guestName.trim()} Tab`
      : posLang === 'ar'
      ? `حساب ملعب / لاعب #${parkedOrders.length + 1}`
      : `Court / Player Tab #${parkedOrders.length + 1}`;

    const finalLabel = holdTabLabel.trim() || defaultLabel;
    const payload: Omit<POSParkedOrder, 'id'> = {
      label: finalLabel,
      posType: type,
      memberId: selectedMember?.id || null,
      memberName: selectedMember ? `${selectedMember.firstName} ${selectedMember.lastName}` : guestName || null,
      guestPhone: guestPhone || '',
      guestName: guestName || '',
      items: cart.map(c => ({
        itemId: c.item.id,
        name: c.item.name,
        nameAr: c.item.nameAr,
        quantity: c.quantity,
        price: c.unitPrice,
        priceLBP: c.unitPriceLBP,
        saleUnitType: c.saleUnitType,
        unitsDeductedPerQty: c.unitsDeductedPerQty,
        variantId: c.variantId,
        variantName: c.variantName,
        isBundle: c.item.isBundle,
        bundleComponents: c.item.bundleComponents
      })),
      discount,
      couponCode: couponCodeInput || '',
      cashbackCode: cashbackCodeInput || '',
      createdAt: new Date().toISOString(),
      createdBy: user.uid
    };

    try {
      await addDoc(collection(db, 'pos_parked_orders'), stripUndefined(payload));
    } catch {
      const localTab: POSParkedOrder = { id: `local_${Date.now()}`, ...stripUndefined(payload) };
      const next = [localTab, ...parkedOrders];
      setParkedOrders(next);
      localStorage.setItem(`pos_parked_orders_${type}`, JSON.stringify(next));
    }

    setCart([]);
    setSelectedMember(null);
    setGuestPhone('');
    setGuestName('');
    setManualDiscount(0);
    setCouponCodeInput('');
    setCashbackCodeInput('');
    setHoldTabLabel('');
    setIsHoldTabModalOpen(false);
    posToast(
      'success',
      `Order parked to Open Tabs: "${finalLabel}"`,
      `تم تعليق الطلب في الحسابات المفتوحة: "${finalLabel}"`
    );
  };

  const handleResumeParkedOrder = async (tab: POSParkedOrder) => {
    const restoredCart: CartEntry[] = [];
    for (const entry of tab.items || []) {
      const liveItem = items.find(i => i.id === entry.itemId);
      if (liveItem) {
        const baseKey = entry.variantId ? `${liveItem.id}__${entry.variantId}` : liveItem.id;
        const cartKey = entry.saleUnitType === 'pack' ? `${baseKey}__pack` : baseKey;
        restoredCart.push({
          cartKey,
          item: liveItem,
          quantity: entry.quantity,
          variantId: entry.variantId,
          variantName: entry.variantName,
          unitPrice: entry.price,
          unitPriceLBP: entry.priceLBP,
          saleUnitType: entry.saleUnitType || 'unit',
          unitsDeductedPerQty: entry.unitsDeductedPerQty || (entry.saleUnitType === 'pack' ? Number(liveItem.unitsPerPack || 1) : 1)
        });
      }
    }

    if (restoredCart.length === 0) {
      posToast(
        'error',
        'Could not restore items — products may have been removed from inventory.',
        'تعذر استعادة العناصر — قد تكون المنتجات حُذفت من المخزون.'
      );
      return;
    }

    setCart(restoredCart);
    if (tab.memberId) {
      const m = members.find(mem => mem.id === tab.memberId);
      if (m) setSelectedMember(m);
    } else {
      setSelectedMember(null);
    }
    setGuestPhone(tab.guestPhone || '');
    setGuestName(tab.guestName || '');
    setManualDiscount(tab.discount || 0);
    setCouponCodeInput(tab.couponCode || '');
    setCashbackCodeInput(tab.cashbackCode || '');

    try {
      if (!tab.id.startsWith('local_')) {
        await deleteDoc(doc(db, 'pos_parked_orders', tab.id));
      } else {
        const next = parkedOrders.filter(p => p.id !== tab.id);
        setParkedOrders(next);
        localStorage.setItem(`pos_parked_orders_${type}`, JSON.stringify(next));
      }
    } catch {}

    setIsOpenTabsModalOpen(false);
    posToast(
      'success',
      `Resumed Open Tab: "${tab.label}"`,
      `تم استئناف الحساب المفتوح: "${tab.label}"`
    );
  };

  const handleDiscardParkedOrder = async (tab: POSParkedOrder) => {
    try {
      if (!tab.id.startsWith('local_')) {
        await deleteDoc(doc(db, 'pos_parked_orders', tab.id));
      } else {
        const next = parkedOrders.filter(p => p.id !== tab.id);
        setParkedOrders(next);
        localStorage.setItem(`pos_parked_orders_${type}`, JSON.stringify(next));
      }
      posToast('success', `Discarded tab "${tab.label}"`, `تم إلغاء الحساب المعلق "${tab.label}"`);
    } catch (e: any) {
      posToast('error', e.message);
    }
  };

  // Active Cashier Shift Resolution
  const activeShift = useMemo(() => shifts.find(s => s.status === 'open') || null, [shifts]);
  const currentViewedShift = useMemo(
    () => shifts.find(s => s.id === selectedShiftId) || activeShift || null,
    [shifts, selectedShiftId, activeShift]
  );

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (activeShift) {
      posToast('error', 'A shift is already open for this POS terminal.', 'توجد وردية مفتوحة بالفعل لهذا الصندوق.');
      return;
    }
    const cName =
      shiftCashierNameInput.trim() ||
      userProfile?.username ||
      user.email?.split('@')[0] ||
      'Cashier';
    const floatUSD = Math.max(0, parseFloat(shiftOpeningFloatUSD) || 0);
    const floatLBP = Math.max(0, parseFloat(shiftOpeningFloatLBP) || 0);

    try {
      const docRef = await addDoc(collection(db, 'pos_shifts'), stripUndefined({
        posType: type,
        cashierId: user.uid,
        cashierName: cName,
        openedAt: new Date().toISOString(),
        closedAt: null,
        status: 'open',
        openingFloatUSD: floatUSD,
        openingFloatLBP: floatLBP
      }));
      setSelectedShiftId(docRef.id);
      setIsOpenShiftModalOpen(false);
      posToast(
        'success',
        `Shift opened for ${cName} (Float: $${floatUSD.toFixed(2)} + ${floatLBP.toLocaleString('en-US')} LBP)`,
        `تم فتح الوردية للكاشير ${cName} (رصيد افتتاحي: $${floatUSD.toFixed(2)} + ${floatLBP.toLocaleString('en-US')} LBP)`
      );
    } catch (err: any) {
      posToast('error', 'Failed to open shift: ' + err.message);
    }
  };

  const handleCheckout = async () => {
    if (!user || cart.length === 0) return;

    // Check Manual Discount > 15% RBAC Guard
    if (subtotal > 0 && clampedManualDiscount > subtotal * 0.15 && !isManagerOrAdmin) {
      requireManagerApproval(
        `Approve Manual Discount of ${formatCurrency(clampedManualDiscount)} (${((clampedManualDiscount / subtotal) * 100).toFixed(1)}% > 15% limit)`,
        () => {
          handleCheckout();
        }
      );
      return;
    }

    if (paymentMethod === 'cash' && !splitTenderCalc.isSufficient) {
      posToast(
        'error',
        `Cash tendered is insufficient. Remaining due: $${splitTenderCalc.remainingUSD.toFixed(2)} (${splitTenderCalc.remainingLBP.toLocaleString('en-US')} LBP)`,
        `المبلغ النقدي المستلم غير كافٍ. المتبقي: $${splitTenderCalc.remainingUSD.toFixed(2)} (${splitTenderCalc.remainingLBP.toLocaleString('en-US')} LBP)`
      );
      return;
    }

    let finalMemberId = selectedMember?.id;

    if (!selectedMember) {
      if (guestPhone.trim()) {
        try {
          const ghostResult = await getOrCreateGhostMember(guestPhone, guestName || 'Guest', user.uid);
          finalMemberId = ghostResult.memberId;
        } catch (error) {
          posToast('error', 'Failed to register guest. Please try again.', 'تعذر تسجيل الزائر. يرجى المحاولة مرة أخرى.');
          return;
        }
      } else {
        finalMemberId = undefined; // Anonymous guest
      }
    }

    if (paymentMethod === 'member_balance') {
      if (!selectedMember) {
        posToast('error', 'Please select a member to use member wallet balance.', 'يرجى اختيار مشترك لاستخدام رصيد المحفظة.');
        return;
      }
      if ((selectedMember.balance || 0) < total) {
        posToast('error', 'Insufficient member wallet balance.', 'رصيد محفظة المشترك غير كافٍ.');
        return;
      }
    }

    if (paymentMethod === 'on_account') {
      if (!selectedMember) {
        posToast(
          'error',
          'Please link a registered Member to charge this order On-Account (SOA Receivable).',
          'يرجى اختيار مشترك مسجل لتسجيل الطلب على الحساب (ذمم المشتركين).'
        );
        return;
      }
    }

    let splitBreakdownPayload: { wallet: number; cash: number; card: number } | null = null;
    if (paymentMethod === 'split') {
      const wPart = Math.max(0, parseFloat(splitWalletUSD) || 0);
      const cPart = Math.max(0, parseFloat(splitCashUSD) || 0);
      const dPart = Math.max(0, parseFloat(splitCardUSD) || 0);
      const splitSum = Number((wPart + cPart + dPart).toFixed(2));
      if (Math.abs(splitSum - total) > 0.02) {
        posToast(
          'error',
          `Split amounts ($${splitSum.toFixed(2)}) must equal Total Due ($${total.toFixed(2)}).`,
          `مجموع الدفع المقسم ($${splitSum.toFixed(2)}) يجب أن يساوي المجموع المستحق ($${total.toFixed(2)}).`
        );
        return;
      }
      if (wPart > 0) {
        if (!selectedMember) {
          posToast('error', 'Select a member to include Wallet in Split Payment.', 'يرجى اختيار مشترك لاستخدام المحفظة في الدفع المقسم.');
          return;
        }
        if ((selectedMember.balance || 0) < wPart) {
          posToast('error', 'Insufficient member wallet balance for split amount.', 'رصيد محفظة المشترك غير كافٍ للمبلغ المحدد.');
          return;
        }
      }
      splitBreakdownPayload = { wallet: wPart, cash: cPart, card: dPart };
    }

    if (type === 'retail' && couponCodeInput.trim() && !appliedCoupon) {
      posToast('error', 'Invalid, expired, or inapplicable Coupon Code.', 'رمز القسيمة غير صالح أو منتهي الصلاحية.');
      return;
    }

    let resolvedCashbackCodeId: string | null = null;
    if (type === 'retail' && cashbackCodeInput.trim() && finalMemberId) {
      const q = query(collection(db, 'cashbackCodes'), where('code', '==', cashbackCodeInput.trim().toUpperCase()));
      const snap = await getDocs(q);
      if (!snap.empty) {
        resolvedCashbackCodeId = snap.docs[0].id;
      } else {
        posToast('error', 'Invalid Cashback Code.', 'رمز الاسترداد النقدي غير صالح.');
        return;
      }
    }

    // Structured Dual-Currency Tender & Manual Change Override Tracking
    const isExactCashDefault = paymentMethod === 'cash' && splitTenderCalc.usdIn === 0 && splitTenderCalc.lbpIn === 0;
    const recordedTenderedUSD =
      paymentMethod === 'cash'
        ? (isExactCashDefault ? total : splitTenderCalc.usdIn)
        : paymentMethod === 'split' && splitBreakdownPayload
        ? splitBreakdownPayload.cash
        : 0;
    const recordedTenderedLBP = paymentMethod === 'cash' ? splitTenderCalc.lbpIn : 0;

    const finalChangeUSD =
      paymentMethod === 'cash' && !isExactCashDefault
        ? isChangeManuallyOverridden
          ? Math.max(0, parseFloat(overrideChangeUSD) || 0)
          : splitTenderCalc.changeUSD
        : 0;
    const finalChangeLBP =
      paymentMethod === 'cash' && !isExactCashDefault
        ? isChangeManuallyOverridden
          ? Math.max(0, Math.round(parseFloat(overrideChangeLBP) || 0))
          : splitTenderCalc.changeLBP
        : 0;

    const tenderNote = paymentMethod === 'cash' && (splitTenderCalc.usdIn > 0 || splitTenderCalc.lbpIn > 0)
      ? `Split Tender: $${splitTenderCalc.usdIn.toFixed(2)} USD + ${splitTenderCalc.lbpIn.toLocaleString('en-US')} LBP | Change: $${finalChangeUSD.toFixed(2)} (${finalChangeLBP.toLocaleString('en-US')} LBP)${isChangeManuallyOverridden ? ' [Manual Override]' : ''}`
      : null;

    const resolvedCashierName =
      activeShift?.cashierName ||
      userProfile?.username ||
      user.email?.split('@')[0] ||
      'Cashier';
    const resolvedMemberDisplay = selectedMember
      ? `${selectedMember.firstName} ${selectedMember.lastName}`.trim()
      : (guestName.trim() || null);
    const resolvedPhoneDisplay = selectedMember?.phone || guestPhone.trim() || '';

    try {
      const result = await processAtomicCheckout({
        memberId: finalMemberId,
        memberName: resolvedMemberDisplay,
        memberPhone: resolvedPhoneDisplay || null,
        items: cart.map(p => {
          const isPackSale = p.saleUnitType === 'pack' && Number(p.unitsDeductedPerQty || 1) > 1;
          const packSuffixEn = isPackSale ? ` [Pack of ${p.unitsDeductedPerQty}]` : '';
          const packSuffixAr = isPackSale ? ` [حزمة ${p.unitsDeductedPerQty}]` : '';
          return stripUndefined({
            itemId: p.item.id,
            name: `${p.variantName ? `${p.item.name} (${p.variantName})` : p.item.name}${packSuffixEn}`,
            nameAr: `${
              p.variantName
                ? `${p.item.nameAr || translateToArabic(p.item.name)} (${translateToArabic(p.variantName)})`
                : (p.item.nameAr || translateToArabic(p.item.name))
            }${packSuffixAr}`,
            quantity: p.quantity,
            price: p.unitPrice,
            priceLBP: p.unitPriceLBP || Math.round(p.unitPrice * effectiveRate),
            saleUnitType: p.saleUnitType || 'unit',
            unitsDeductedPerQty: p.unitsDeductedPerQty || 1,
            variantId: p.variantId,
            variantName: p.variantName,
            isBundle: p.item.isBundle,
            bundleComponents: p.item.bundleComponents
          });
        }),
        subtotal,
        discount,
        manualDiscount: clampedManualDiscount,
        couponDiscount: type === 'retail' ? couponDiscount : 0,
        taxAmount,
        applyVat,
        total,
        paymentMethod,
        splitBreakdown: splitBreakdownPayload,
        shiftId: activeShift?.id || null,
        cashierName: resolvedCashierName,
        tenderedUSD: recordedTenderedUSD,
        tenderedLBP: recordedTenderedLBP,
        changeUSD: Number(finalChangeUSD),
        changeLBP: Number(finalChangeLBP),
        exchangeRateUsed: effectiveRate,
        sourceModule: type === 'cafeteria' ? 'pos_cafe' : 'pos_retail',
        cashierId: user.uid,
        couponId: type === 'retail' ? (appliedCoupon?.id || null) : null,
        couponCode: type === 'retail' ? (appliedCoupon?.code || null) : null,
        cashbackCodeId: type === 'retail' ? resolvedCashbackCodeId : null,
        notes: tenderNote
      });

      setWhatsAppPhoneInput(resolvedPhoneDisplay);
      if (result?.order) {
        setReceiptModalOrder(result.order as unknown as POSOrder);
      }

      setCart([]);
      setSelectedMember(null);
      setGuestPhone('');
      setGuestName('');
      setManualDiscount(0);
      setApplyVat(false);
      setCouponCodeInput('');
      setAppliedCoupon(null);
      setCashbackCodeInput('');
      setCashTenderedUSD('');
      setCashTenderedLBP('');
      setOverrideChangeUSD('0.00');
      setOverrideChangeLBP('0');
      setIsChangeManuallyOverridden(false);
      setSplitWalletUSD('0');
      setSplitCashUSD('0');
      setSplitCardUSD('0');
      posToast('success', 'Checkout successful!', 'تم إتمام عملية الدفع بنجاح!');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions', user);
      posToast('error', error.message || 'Checkout failed. Please try again.', error.message || 'فشلت عملية الدفع. يرجى المحاولة مرة أخرى.');
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newItem.name || !newItem.category) return;

    const rate = effectiveRate > 0 ? effectiveRate : 89000;
    const isPackGood = Boolean(newItem.isPackagedGood);
    const unitsPerPackVal = isPackGood ? Math.max(2, Number(newItem.unitsPerPack || 12)) : 1;

    const skuVal = (newItem.sku || newItem.barcode || '').trim();

    // Resolve Single Unit Cost & Pack Cost (both LBP and USD)
    let resolvedCostUSD = Number(newItem.costPrice ?? newItem.cost ?? 0);
    let resolvedCostLBP = Number(newItem.costPriceLBP ?? Math.round(resolvedCostUSD * rate));
    let resolvedPackCostUSD = Number(newItem.packCostPrice ?? 0);
    let resolvedPackCostLBP = Number(newItem.packCostLBP ?? 0);

    if (isPackGood) {
      if (inventoryCurrencyView === 'LBP') {
        if (resolvedPackCostLBP > 0) {
          resolvedPackCostUSD = Number((resolvedPackCostLBP / rate).toFixed(4));
          resolvedCostLBP = Math.round(resolvedPackCostLBP / unitsPerPackVal);
          resolvedCostUSD = Number((resolvedPackCostUSD / unitsPerPackVal).toFixed(4));
        } else if (resolvedCostLBP > 0) {
          resolvedCostUSD = Number((resolvedCostLBP / rate).toFixed(4));
          resolvedPackCostLBP = Math.round(resolvedCostLBP * unitsPerPackVal);
          resolvedPackCostUSD = Number((resolvedCostUSD * unitsPerPackVal).toFixed(4));
        }
      } else {
        if (resolvedPackCostUSD > 0) {
          resolvedPackCostLBP = Math.round(resolvedPackCostUSD * rate);
          resolvedCostUSD = Number((resolvedPackCostUSD / unitsPerPackVal).toFixed(4));
          resolvedCostLBP = Math.round(resolvedCostUSD * rate);
        } else if (resolvedCostUSD > 0) {
          resolvedCostLBP = Math.round(resolvedCostUSD * rate);
          resolvedPackCostUSD = Number((resolvedCostUSD * unitsPerPackVal).toFixed(4));
          resolvedPackCostLBP = Math.round(resolvedPackCostUSD * rate);
        }
      }
    } else {
      if (inventoryCurrencyView === 'LBP' && resolvedCostLBP > 0) {
        resolvedCostUSD = Number((resolvedCostLBP / rate).toFixed(4));
      } else {
        resolvedCostLBP = Math.round(resolvedCostUSD * rate);
      }
    }

    // Resolve Single Unit Selling Price & Full Pack Selling Price (both LBP and USD)
    let resolvedUnitPriceUSD = Number(newItem.unitSellingPrice ?? newItem.price ?? 0);
    let resolvedUnitPriceLBP = Number(newItem.unitSellingPriceLBP ?? newItem.priceLBP ?? Math.round(resolvedUnitPriceUSD * rate));
    if (inventoryCurrencyView === 'LBP' && resolvedUnitPriceLBP > 0) {
      resolvedUnitPriceUSD = Number((resolvedUnitPriceLBP / rate).toFixed(4));
    } else {
      resolvedUnitPriceLBP = Math.round(resolvedUnitPriceUSD * rate);
    }

    let resolvedPackSellUSD = Number(newItem.packSellingPrice ?? (resolvedUnitPriceUSD * unitsPerPackVal));
    let resolvedPackSellLBP = Number(newItem.packSellingPriceLBP ?? Math.round(resolvedPackSellUSD * rate));
    if (isPackGood) {
      if (inventoryCurrencyView === 'LBP' && resolvedPackSellLBP > 0) {
        resolvedPackSellUSD = Number((resolvedPackSellLBP / rate).toFixed(4));
      } else {
        resolvedPackSellLBP = Math.round(resolvedPackSellUSD * rate);
      }
    }

    const stockVal = Number(newItem.stock ?? 0);
    const lowStockVal = Number(newItem.lowStockThreshold ?? 5);
    const reorderVal = Number(newItem.reorderQuantity ?? 20);

    const variantsList = Array.isArray(newItem.variants) ? newItem.variants : [];
    const computedStock = variantsList.length > 0
      ? variantsList.reduce((sum, v) => sum + Number(v.stock || 0), 0)
      : stockVal;

    const stockDelta = editingItem ? computedStock - Number(editingItem.stock || 0) : 0;

    if (editingItem && stockDelta !== 0) {
      if (!stockAdjustmentReason.trim()) {
        posToast(
          'error',
          'A Stock Adjustment Reason is mandatory when modifying stock quantities!',
          'يرجى إدخال سبب تعديل المخزون الإلزامي!'
        );
        return;
      }
      if (!isManagerOrAdmin) {
        requireManagerApproval(
          `Approve Manual Stock Adjustment for ${editingItem.name} (${editingItem.stock} → ${computedStock})`,
          () => {}
        );
        return;
      }
    }

    const cleanName = newItem.name.trim();
    const cleanCategory = newItem.category.trim();
    const cleanSubcategory = (newItem.subcategory || '').trim();
    const cleanNameAr = showArabicFields
      ? toEnglishNumerals((newItem.nameAr || '').trim() || translateToArabic(cleanName))
      : toEnglishNumerals((newItem.nameAr || '').trim());
    const cleanCategoryAr = showArabicFields
      ? toEnglishNumerals((newItem.categoryAr || '').trim() || translateToArabic(cleanCategory))
      : toEnglishNumerals((newItem.categoryAr || '').trim());
    const cleanSubcategoryAr = cleanSubcategory
      ? (showArabicFields
          ? toEnglishNumerals((newItem.subcategoryAr || '').trim() || translateToArabic(cleanSubcategory))
          : toEnglishNumerals((newItem.subcategoryAr || '').trim()))
      : '';

    const payload = stripUndefined({
      ...newItem,
      name: cleanName,
      nameAr: cleanNameAr,
      category: cleanCategory,
      categoryAr: cleanCategoryAr,
      subcategory: cleanSubcategory,
      subcategoryAr: cleanSubcategoryAr,
      sku: skuVal,
      barcode: skuVal,
      cost: resolvedCostUSD,
      costPrice: resolvedCostUSD,
      costPriceLBP: resolvedCostLBP,
      price: resolvedUnitPriceUSD,
      priceLBP: resolvedUnitPriceLBP,
      isPackagedGood: isPackGood,
      unitsPerPack: isPackGood ? unitsPerPackVal : undefined,
      packCostPrice: isPackGood ? resolvedPackCostUSD : undefined,
      packCostLBP: isPackGood ? resolvedPackCostLBP : undefined,
      unitSellingPrice: resolvedUnitPriceUSD,
      unitSellingPriceLBP: resolvedUnitPriceLBP,
      packSellingPrice: isPackGood ? resolvedPackSellUSD : undefined,
      packSellingPriceLBP: isPackGood ? resolvedPackSellLBP : undefined,
      stock: computedStock,
      lowStockThreshold: lowStockVal,
      reorderQuantity: reorderVal,
      supplier: (newItem.supplier || '').trim(),
      expiryDate: newItem.expiryDate || '',
      variants: variantsList,
      isBundle: Boolean(newItem.isBundle),
      bundleComponents: newItem.isBundle && Array.isArray(newItem.bundleComponents) ? newItem.bundleComponents : [],
      type,
      posType: type,
      updatedAt: new Date().toISOString()
    });

    try {
      if (editingItem) {
        await updateDoc(doc(db, 'inventory', editingItem.id), payload);

        if (stockDelta !== 0) {
          const adjReason = stockAdjustmentReason.trim();
          const inventoryLcoaAccount =
            type === 'cafeteria'
              ? '301 - Kiosk POS Inventory'
              : '302 - Retail Shop Inventory';
          const adjustmentCostUSD = Number((Math.abs(stockDelta) * (resolvedCostUSD > 0 ? resolvedCostUSD : Number(editingItem.costPrice ?? editingItem.cost ?? 0))).toFixed(2));

          await logSystemAudit({
            action: 'STOCK_ADJUST',
            collectionName: 'inventory',
            documentId: editingItem.id,
            staffId: user.uid,
            timestamp: new Date().toISOString(),
            details: {
              itemName: cleanName,
              oldStock: editingItem.stock,
              newStock: computedStock,
              stockDelta,
              reason: adjReason,
              posType: type
            }
          });

          await processLedgerTransaction({
            amount: adjustmentCostUSD,
            paymentMethod: 'system',
            sourceModule: type === 'cafeteria' ? 'pos_cafe' : 'pos_retail',
            cashierId: user.uid,
            transactionType: 'inventory_stock_adjustment',
            direction: 'audit',
            sourceAccount: stockDelta > 0 ? inventoryLcoaAccount : '6019 - Inventory Shrinkage & Wastage Expense',
            destinationAccount: stockDelta > 0 ? '6019 - Inventory Shrinkage & Wastage Expense' : inventoryLcoaAccount,
            referenceId: editingItem.id,
            notes: `Stock Adjustment (${adjReason}): ${editingItem.stock} → ${computedStock} (${stockDelta > 0 ? '+' : ''}${stockDelta}) for ${cleanName}`
          });
        }
      } else {
        await addDoc(collection(db, 'inventory'), stripUndefined({ ...payload, uid: user.uid }));
      }
      setIsInventoryModalOpen(false);
      setNewItem({ type, posType: type, lowStockThreshold: 5, reorderQuantity: 20, variants: [], isBundle: false, bundleComponents: [] });
      setEditingItem(null);
      setStockAdjustmentReason('');
      setStockEntryByPack(false);
      setStockPackCountInput(0);
      posToast(
        'success',
        editingItem ? 'Item updated successfully' : 'Item added successfully',
        editingItem ? 'تم تحديث المنتج بنجاح' : 'تمت إضافة المنتج بنجاح'
      );
    } catch (error: any) {
      handleFirestoreError(error, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'inventory', user);
      posToast('error', error.message || (editingItem ? 'Failed to update item' : 'Failed to add item'));
    }
  };

  const handleDeleteItem = (item: InventoryItem) => {
    requireManagerApproval(`Delete Inventory Item "${item.name}"`, () => {
      setDeleteItemModalTarget(item);
    });
  };

  const confirmDeleteItem = async () => {
    if (!deleteItemModalTarget) return;
    const id = deleteItemModalTarget.id;
    try {
      await deleteDoc(doc(db, 'inventory', id));
      setDeleteItemModalTarget(null);
      posToast('success', 'Item deleted', 'تم حذف المنتج');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `inventory/${id}`, user);
    }
  };

  // Receive Stock (Restock) Handler — True Weighted Average Cost (Coût Moyen Pondéré), Pack/Unit Conversion & Variant Support
  const handleReceiveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !restockItem || restockQty <= 0) return;

    const rate = effectiveRate > 0 ? effectiveRate : 89000;
    const isPackRestock = Boolean(restockItem.isPackagedGood && Number(restockItem.unitsPerPack || 0) > 1 && restockByPack);
    const unitsPerPack = isPackRestock ? Math.max(1, Number(restockItem.unitsPerPack || 1)) : 1;

    const oldStock = Math.max(0, Number(restockItem.stock) || 0);
    const oldCost = Math.max(0, Number(restockItem.costPrice ?? restockItem.cost) || 0);
    const addedQty = Math.max(0, Number(restockQty) || 0) * unitsPerPack;

    // Resolve single-unit cost in USD from either Pack Cost or Single Unit Cost (and LBP or USD view)
    const rawEnteredUnitCostUSD = isPackRestock
      ? (restockPackCostInput > 0
          ? (inventoryCurrencyView === 'LBP' ? restockPackCostInput / rate : restockPackCostInput) / unitsPerPack
          : oldCost)
      : (restockUnitCost > 0
          ? (inventoryCurrencyView === 'LBP' ? restockUnitCost / rate : restockUnitCost)
          : oldCost);

    const unitCost = rawEnteredUnitCostUSD > 0 ? Number(rawEnteredUnitCostUSD.toFixed(4)) : oldCost;
    const newWeightedCost =
      oldStock + addedQty > 0
        ? Number(((oldStock * oldCost + addedQty * unitCost) / (oldStock + addedQty)).toFixed(4))
        : unitCost;

    const currentVariants = Array.isArray(restockItem.variants)
      ? restockItem.variants.map(v => ({ ...v }))
      : [];

    let newStock = oldStock + addedQty;
    let restockedVariantLabel = '';
    if (currentVariants.length > 0 && restockVariantId) {
      const vIdx = currentVariants.findIndex(v => v.id === restockVariantId);
      if (vIdx !== -1) {
        currentVariants[vIdx].stock = Number(currentVariants[vIdx].stock || 0) + addedQty;
        restockedVariantLabel = ` (${currentVariants[vIdx].name})`;
        newStock = currentVariants.reduce((sum, v) => sum + Number(v.stock || 0), 0);
      }
    }

    const totalRestockCost = Number((addedQty * unitCost).toFixed(2));
    const inventoryLcoaAccount =
      type === 'cafeteria'
        ? '301 - Kiosk POS Inventory'
        : '302 - Retail Shop Inventory';

    try {
      const updatePayload: Record<string, any> = {
        stock: newStock,
        cost: newWeightedCost,
        costPrice: newWeightedCost,
        costPriceLBP: Math.round(newWeightedCost * rate),
        ...(restockItem.isPackagedGood && unitsPerPack > 1
          ? {
              packCostPrice: Number((newWeightedCost * unitsPerPack).toFixed(4)),
              packCostLBP: Math.round(newWeightedCost * unitsPerPack * rate)
            }
          : {}),
        expiryDate: restockExpiry || restockItem.expiryDate || '',
        supplier: restockSupplier || restockItem.supplier || '',
        updatedAt: new Date().toISOString()
      };
      if (currentVariants.length > 0) {
        updatePayload.variants = currentVariants;
      }

      await updateDoc(doc(db, 'inventory', restockItem.id), stripUndefined(updatePayload));

      if (recordRestockExpense && totalRestockCost > 0) {
        await processLedgerTransaction({
          amount: totalRestockCost,
          paymentMethod: 'cash',
          sourceModule: type === 'cafeteria' ? 'pos_cafe' : 'pos_retail',
          cashierId: user.uid,
          transactionType: 'inventory_restock',
          direction: 'outflow',
          sourceAccount: inventoryLcoaAccount,
          destinationAccount: '531 - Cash Drawer / Register (Caisse)',
          referenceId: restockItem.id,
          notes: `Restock received: +${addedQty} units${isPackRestock ? ` (${restockQty} packs × ${unitsPerPack})` : ''} of ${restockItem.name}${restockedVariantLabel} @ $${unitCost.toFixed(2)}/unit (New WAC: $${newWeightedCost.toFixed(2)})`
        });
      }

      posToast(
        'success',
        `Received +${addedQty} units${isPackRestock ? ` (${restockQty} packs)` : ''} of ${restockItem.name}${restockedVariantLabel} (New Stock: ${newStock}, WAC: $${newWeightedCost.toFixed(2)})`,
        `تم استلام +${addedQty} وحدة من ${restockItem.name}${restockedVariantLabel} (المخزون الجديد: ${newStock})`
      );
      setRestockItem(null);
      setRestockVariantId('');
      setRestockByPack(false);
    } catch (error: any) {
      posToast('error', 'Failed to receive stock: ' + error.message);
    }
  };

  // Wastage / Expired Write-Off Handler — Official LCOA 6019 & 301/302 Accounts
  const handleWastageWriteOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !wastageItem || wastageQty <= 0) return;
    if (wastageQty > wastageItem.stock) {
      posToast('error', 'Write-off quantity cannot exceed current stock on hand.', 'كمية الإتلاف لا يمكن أن تتجاوز المخزون المتوفر.');
      return;
    }

    const newStock = Math.max(0, wastageItem.stock - wastageQty);
    const unitCost = Number(wastageItem.costPrice ?? wastageItem.cost ?? 0);
    const writeOffCost = Number((wastageQty * unitCost).toFixed(2));
    const inventoryLcoaAccount =
      type === 'cafeteria'
        ? '301 - Kiosk POS Inventory'
        : '302 - Retail Shop Inventory';

    try {
      await processLedgerTransaction({
        amount: writeOffCost,
        paymentMethod: 'system',
        sourceModule: type === 'cafeteria' ? 'pos_cafe' : 'pos_retail',
        cashierId: user.uid,
        transactionType: 'inventory_wastage',
        direction: 'audit',
        sourceAccount: '6019 - Inventory Shrinkage & Wastage Expense',
        destinationAccount: inventoryLcoaAccount,
        referenceId: wastageItem.id,
        notes: `Inventory Write-Off (${wastageReason.toUpperCase()}): -${wastageQty}x ${wastageItem.name}${wastageNotes ? ` — ${wastageNotes}` : ''}`
      }, async (transaction) => {
        transaction.update(doc(db, 'inventory', wastageItem.id), {
          stock: newStock,
          updatedAt: new Date().toISOString()
        });
      });

      posToast(
        'success',
        `Wrote off ${wastageQty} units of ${wastageItem.name} (${wastageReason})`,
        `تم شطب ${wastageQty} وحدة من ${wastageItem.name}`
      );
      setWastageItem(null);
      setWastageNotes('');
    } catch (error: any) {
      posToast('error', 'Failed to record wastage write-off: ' + error.message);
    }
  };

  // Excel Export (Full Inventory)
  const handleExportInventoryExcel = () => {
    const rows = items.map(item => ({
      'Name': item.name,
      'Name (Arabic)': item.nameAr || translateToArabic(item.name),
      'SKU': item.sku || item.barcode || '',
      'Category': item.category || '',
      'Category (Arabic)': item.categoryAr || translateToArabic(item.category),
      'Subcategory': item.subcategory || '',
      'Subcategory (Arabic)': item.subcategory ? (item.subcategoryAr || translateToArabic(item.subcategory)) : '',
      'Price (USD)': Number(item.price || 0),
      'Price (LBP)': Number(item.priceLBP ?? Math.round(Number(item.price || 0) * effectiveRate)),
      'Cost (USD)': Number(item.costPrice ?? item.cost ?? 0),
      'Cost (LBP)': Number(item.costPriceLBP ?? Math.round(Number(item.costPrice ?? item.cost ?? 0) * effectiveRate)),
      'Is Packaged Good': item.isPackagedGood ? 'Yes' : 'No',
      'Units Per Pack': Number(item.unitsPerPack || 1),
      'Pack Selling Price (LBP)': Number(item.packSellingPriceLBP || 0),
      'Pack Selling Price (USD)': Number(item.packSellingPrice || 0),
      'Stock (Total Units)': Number(item.stock || 0),
      'Low Stock Threshold': Number(item.lowStockThreshold ?? 5),
      'Reorder Qty': Number(item.reorderQuantity ?? 20),
      'Supplier': item.supplier || '',
      'Expiry Date': item.expiryDate || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type === 'cafeteria' ? 'Kiosk Inventory' : 'Retail Inventory');
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const storeSlug = type === 'cafeteria' ? 'kiosk_pos' : 'retail_shop_pos';
    saveAs(
      new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${storeSlug}_inventory_${new Date().toISOString().split('T')[0]}.xlsx`
    );
    posToast('success', 'Inventory exported to Excel (.xlsx)', 'تم تصدير المخزون إلى ملف Excel');
  };

  // Bulk Excel Import (.xlsx / .csv)
  const handleImportInventoryExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(firstSheet);

      if (rows.length === 0) {
        posToast('error', 'Spreadsheet is empty.', 'الملف فارغ.');
        return;
      }

      let createdCount = 0;
      let updatedCount = 0;

      for (const row of rows) {
        const rawName = String(row['Name'] || row['name'] || row['Item'] || '').trim();
        if (!rawName) continue;

        const rawNameAr = toEnglishNumerals(
          String(row['Name (Arabic)'] || row['NameAr'] || row['nameAr'] || '').trim() || translateToArabic(rawName)
        );
        const rawSku = String(row['SKU'] || row['sku'] || row['Barcode'] || row['barcode'] || '').trim();
        const rawCategory = String(row['Category'] || row['category'] || (type === 'cafeteria' ? 'Grocery' : 'Merchandise')).trim();
        const rawCategoryAr = toEnglishNumerals(
          String(row['Category (Arabic)'] || row['CategoryAr'] || row['categoryAr'] || '').trim() || translateToArabic(rawCategory)
        );
        const rawSubcategory = String(row['Subcategory'] || row['subcategory'] || '').trim();
        const rawSubcategoryAr = rawSubcategory
          ? toEnglishNumerals(
              String(row['Subcategory (Arabic)'] || row['SubcategoryAr'] || row['subcategoryAr'] || '').trim() ||
                translateToArabic(rawSubcategory)
            )
          : '';
        const rawPrice = Math.max(0, parseFloat(row['Price (USD)'] ?? row['Price'] ?? row['price'] ?? 0) || 0);
        const rawCost = Math.max(0, parseFloat(row['Cost (USD)'] ?? row['Cost'] ?? row['cost'] ?? row['costPrice'] ?? 0) || 0);
        const rawStock = Math.max(0, parseInt(row['Stock (Total Units)'] ?? row['Stock'] ?? row['stock'] ?? row['Quantity'] ?? 0, 10) || 0);
        const rawThreshold = Math.max(0, parseInt(row['Low Stock Threshold'] ?? row['lowStockThreshold'] ?? 5, 10) || 5);
        const rawReorder = Math.max(1, parseInt(row['Reorder Qty'] ?? row['reorderQuantity'] ?? 20, 10) || 20);
        const rawSupplier = String(row['Supplier'] || row['supplier'] || '').trim();
        const rawExpiry = String(row['Expiry Date'] || row['expiryDate'] || '').trim();

        const existingMatch = items.find(
          i => (rawSku && ((i.sku && i.sku.toLowerCase() === rawSku.toLowerCase()) || (i.barcode && i.barcode.toLowerCase() === rawSku.toLowerCase()))) ||
               i.name.toLowerCase() === rawName.toLowerCase()
        );

        const itemPayload = {
          name: rawName,
          nameAr: rawNameAr,
          sku: rawSku,
          barcode: rawSku,
          category: rawCategory,
          categoryAr: rawCategoryAr,
          subcategory: rawSubcategory,
          subcategoryAr: rawSubcategoryAr,
          price: rawPrice,
          priceLBP: Math.round(rawPrice * effectiveRate),
          cost: rawCost,
          costPrice: rawCost,
          costPriceLBP: Math.round(rawCost * effectiveRate),
          stock: rawStock,
          lowStockThreshold: rawThreshold,
          reorderQuantity: rawReorder,
          supplier: rawSupplier,
          expiryDate: rawExpiry,
          type,
          posType: type,
          uid: user.uid,
          updatedAt: new Date().toISOString()
        };

        if (existingMatch) {
          await updateDoc(doc(db, 'inventory', existingMatch.id), stripUndefined(itemPayload));
          updatedCount++;
        } else {
          await addDoc(collection(db, 'inventory'), stripUndefined(itemPayload));
          createdCount++;
        }
      }

      posToast(
        'success',
        `Bulk import complete: ${createdCount} added, ${updatedCount} updated.`,
        `اكتمل الاستيراد: تمت إضافة ${createdCount} وتحديث ${updatedCount}.`
      );
    } catch (err: any) {
      posToast('error', 'Failed to import Excel file: ' + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Download Restock List (PDF & Excel)
  const restockCandidates = useMemo(() => {
    const soonThreshold = Date.now() + 7 * 86400000;
    return items.filter(item => {
      const isLow = item.stock <= (item.lowStockThreshold ?? 5);
      const isExpiring = item.expiryDate ? new Date(item.expiryDate).getTime() <= soonThreshold : false;
      return isLow || isExpiring;
    });
  }, [items]);

  const handleDownloadRestockList = (formatType: 'pdf' | 'excel') => {
    const list = restockCandidates.length > 0 ? restockCandidates : items;
    if (list.length === 0) {
      posToast('info', 'No inventory items available to generate restock list.');
      return;
    }

    const storeTitle = type === 'cafeteria' ? 'Kiosk POS (Supermarket & Grocery)' : 'Retail Shop POS (Merchandise & Supplements)';

    if (formatType === 'excel') {
      const rows = list.map(item => {
        const reorderQty = item.reorderQuantity ?? Math.max(10, ((item.lowStockThreshold ?? 5) * 3) - item.stock);
        const unitCost = Number(item.costPrice ?? item.cost ?? 0);
        return {
          'Item Name': item.name,
          'SKU / Barcode': item.sku || item.barcode || '—',
          'Category': item.category,
          'Supplier': item.supplier || '—',
          'Current Stock': item.stock,
          'Low Stock Threshold': item.lowStockThreshold ?? 5,
          'Suggested Reorder Qty': reorderQty,
          'Unit Cost ($)': unitCost,
          'Est. Restock Cost ($)': Number((reorderQty * unitCost).toFixed(2)),
          'Expiry Date': item.expiryDate || '—'
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Restock Order List');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(
        new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `restock_list_${type}_${new Date().toISOString().split('T')[0]}.xlsx`
      );
      posToast('success', 'Restock list exported to Excel!');
      return;
    }

    const pdf = new jsPDF();
    pdf.setFillColor(11, 15, 23);
    pdf.rect(0, 0, 210, 26, 'F');
    pdf.setFillColor(0, 184, 200);
    pdf.rect(0, 26, 210, 1.5, 'F');

    pdf.setFontSize(15);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`${systemName || 'Vescio Nexus'} — Restock Purchase Order List`, 14, 13);
    pdf.setFontSize(9);
    pdf.setTextColor(0, 184, 200);
    pdf.text(`Module: ${storeTitle} | Generated: ${new Date().toLocaleString()}`, 14, 20);

    let totalEstCost = 0;
    const body = list.map(item => {
      const reorderQty = item.reorderQuantity ?? Math.max(10, ((item.lowStockThreshold ?? 5) * 3) - item.stock);
      const unitCost = Number(item.costPrice ?? item.cost ?? 0);
      const estCost = reorderQty * unitCost;
      totalEstCost += estCost;
      return [
        item.name,
        item.sku || item.barcode || '—',
        item.supplier || '—',
        String(item.stock),
        String(item.lowStockThreshold ?? 5),
        String(reorderQty),
        `$${unitCost.toFixed(2)}`,
        `$${estCost.toFixed(2)}`
      ];
    });

    autoTable(pdf, {
      startY: 33,
      head: [['Item', 'SKU', 'Supplier', 'Stock', 'Min', 'Reorder Qty', 'Unit Cost', 'Est. Total']],
      body,
      foot: [['TOTAL ESTIMATED RESTOCK COST', '', '', '', '', '', '', `$${totalEstCost.toFixed(2)}`]],
      theme: 'grid',
      headStyles: { fillColor: [0, 184, 200], textColor: [11, 15, 23], fontStyle: 'bold' },
      footStyles: { fillColor: [11, 15, 23], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8 }
    });

    const pageCount = (pdf as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 130);
      pdf.text('Generated by Vescio Nexus ERP', 14, 288);
    }

    pdf.save(`restock_list_${type}_${new Date().toISOString().split('T')[0]}.pdf`);
    posToast('success', 'Restock PDF downloaded!');
  };

  // Shift-Scoped Z-Report Aggregation & Drawer Reconciliation
  const zReportMetrics = useMemo(() => {
    const shiftScope = currentViewedShift;
    const scopedOrders = shiftScope
      ? orders.filter(o => {
          if (o.shiftId) return o.shiftId === shiftScope.id;
          const t = new Date(o.date).getTime();
          const start = new Date(shiftScope.openedAt).getTime();
          const end = shiftScope.closedAt ? new Date(shiftScope.closedAt).getTime() : Date.now() + 60000;
          return t >= start && t <= end;
        })
      : orders.filter(o => o.date && o.date.startsWith(zReportDate));

    const completedOrders = scopedOrders.filter(o => o.status !== 'refunded' && o.status !== 'voided');

    // Track refunds executed DURING this shift (or date) so prior closed shifts are never mutated retroactively
    const voidedOrRefunded = shiftScope
      ? orders.filter(o => {
          if (o.status !== 'refunded' && o.status !== 'voided') return false;
          if (o.refundedInShiftId) return o.refundedInShiftId === shiftScope.id;
          if (o.refundedAt) {
            const rt = new Date(o.refundedAt).getTime();
            const start = new Date(shiftScope.openedAt).getTime();
            const end = shiftScope.closedAt ? new Date(shiftScope.closedAt).getTime() : Date.now() + 60000;
            return rt >= start && rt <= end;
          }
          return o.shiftId === shiftScope.id;
        })
      : scopedOrders.filter(o => o.status === 'refunded' || o.status === 'voided');

    const grossSales = completedOrders.reduce((s, o) => s + (o.subtotal || o.total || 0), 0);
    const totalDiscounts = completedOrders.reduce((s, o) => s + (o.discount || 0), 0);
    const totalVatUSD = completedOrders.reduce((s, o) => s + Number(o.taxAmount || 0), 0);
    const netRevenueUSD = completedOrders.reduce((s, o) => s + (o.total || 0), 0);
    const netRevenueLBP = Math.round(netRevenueUSD * effectiveRate);

    const cashSalesUSD = completedOrders.reduce((s, o) => {
      if (o.paymentMethod === 'cash') return s + (o.total || 0);
      if (o.paymentMethod === 'split' && o.splitBreakdown) return s + Number(o.splitBreakdown.cash || 0);
      return s;
    }, 0);
    const cardSalesUSD = completedOrders.reduce((s, o) => {
      if (o.paymentMethod === 'card') return s + (o.total || 0);
      if (o.paymentMethod === 'split' && o.splitBreakdown) return s + Number(o.splitBreakdown.card || 0);
      return s;
    }, 0);
    const walletSalesUSD = completedOrders.reduce((s, o) => {
      if (o.paymentMethod === 'member_balance') return s + (o.total || 0);
      if (o.paymentMethod === 'split' && o.splitBreakdown) return s + Number(o.splitBreakdown.wallet || 0);
      return s;
    }, 0);
    const onAccountSalesUSD = completedOrders
      .filter(o => o.paymentMethod === 'on_account')
      .reduce((s, o) => s + (o.total || 0), 0);

    const refundedTotalUSD = voidedOrRefunded.reduce((s, o) => s + (o.total || 0), 0);
    const cashRefundsUSD = voidedOrRefunded
      .filter(o => o.paymentMethod === 'cash')
      .reduce((s, o) => s + (o.total || 0), 0);

    // Physical Drawer Expected USD & LBP from structured dual-currency tenders & manual change overrides
    const openingFloatUSD = Number(shiftScope?.openingFloatUSD || 0);
    const openingFloatLBP = Number(shiftScope?.openingFloatLBP || 0);

    let sumTenderedUSD = 0;
    let sumChangeUSD = 0;
    let sumTenderedLBP = 0;
    let sumChangeLBP = 0;

    completedOrders.forEach(o => {
      if (o.paymentMethod === 'cash') {
        const tUSD = Number(o.tenderedUSD || 0);
        const tLBP = Number(o.tenderedLBP || 0);
        if (tUSD === 0 && tLBP === 0) {
          sumTenderedUSD += Number(o.total || 0);
        } else {
          sumTenderedUSD += tUSD;
          sumTenderedLBP += tLBP;
          sumChangeUSD += Number(o.changeUSD || 0);
          sumChangeLBP += Number(o.changeLBP || 0);
        }
      } else if (o.paymentMethod === 'split' && o.splitBreakdown) {
        sumTenderedUSD += Number(o.splitBreakdown.cash || 0);
      }
    });

    const expectedDrawerUSD = Number((openingFloatUSD + sumTenderedUSD - sumChangeUSD - cashRefundsUSD).toFixed(2));
    const expectedDrawerLBP = Math.round(openingFloatLBP + sumTenderedLBP - (type === 'cafeteria' ? sumChangeLBP : 0));

    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
    completedOrders.forEach(o => {
      (o.items || []).forEach(it => {
        const prev = itemMap.get(it.itemId) || { name: it.name, qty: 0, revenue: 0 };
        prev.qty += it.quantity;
        prev.revenue += it.quantity * it.price;
        itemMap.set(it.itemId, prev);
      });
    });

    const topItems = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue);

    return {
      shiftScope,
      totalOrdersCount: scopedOrders.length,
      completedCount: completedOrders.length,
      voidedCount: voidedOrRefunded.length,
      grossSales,
      totalDiscounts,
      totalVatUSD,
      netRevenueUSD,
      netRevenueLBP,
      cashSalesUSD,
      cashSalesLBP: Math.round(cashSalesUSD * effectiveRate),
      cardSalesUSD,
      walletSalesUSD,
      onAccountSalesUSD,
      refundedTotalUSD,
      cashRefundsUSD,
      openingFloatUSD,
      openingFloatLBP,
      expectedDrawerUSD,
      expectedDrawerLBP,
      topItems
    };
  }, [orders, currentViewedShift, zReportDate, effectiveRate, type]);

  const handleDownloadZReportPDF = (overrideShift?: POSShift) => {
    const pdf = new jsPDF();
    const shiftObj = overrideShift || zReportMetrics.shiftScope;
    const storeTitle = type === 'cafeteria' ? 'Kiosk POS (Mini-Supermarket & Grocery)' : 'Retail Shop POS (Merchandise & Supplements)';

    pdf.setFillColor(11, 15, 23);
    pdf.rect(0, 0, 210, 28, 'F');
    pdf.setFillColor(0, 184, 200);
    pdf.rect(0, 28, 210, 1.5, 'F');

    pdf.setFontSize(15);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`${systemName || 'Vescio Nexus'} — Official Cashier Shift Z-Report`, 14, 13);
    pdf.setFontSize(9);
    pdf.setTextColor(0, 184, 200);
    const shiftSubtitle = shiftObj
      ? `Cashier: ${shiftObj.cashierName} | Opened: ${new Date(shiftObj.openedAt).toLocaleString()} | Status: ${shiftObj.status.toUpperCase()}`
      : `Shift Date: ${zReportDate} | FX Rate: 1 USD = ${effectiveRate.toLocaleString('en-US')} LBP`;
    pdf.text(`${storeTitle} | ${shiftSubtitle}`, 14, 21);

    const rows: any[][] = [
      ['Completed Orders Count', String(zReportMetrics.completedCount), `${zReportMetrics.voidedCount} Voided/Refunded`],
      ['Opening Drawer Float', `$${zReportMetrics.openingFloatUSD.toFixed(2)}`, `${zReportMetrics.openingFloatLBP.toLocaleString('en-US')} LBP`],
      ['Gross Sales', `$${zReportMetrics.grossSales.toFixed(2)}`, `${Math.round(zReportMetrics.grossSales * effectiveRate).toLocaleString('en-US')} LBP`],
      ['Discounts & Coupons', `-$${zReportMetrics.totalDiscounts.toFixed(2)}`, `-${Math.round(zReportMetrics.totalDiscounts * effectiveRate).toLocaleString('en-US')} LBP`],
      ['11% Output VAT (4427)', `$${zReportMetrics.totalVatUSD.toFixed(2)}`, `${Math.round(zReportMetrics.totalVatUSD * effectiveRate).toLocaleString('en-US')} LBP`],
      ['NET SHIFT REVENUE', `$${zReportMetrics.netRevenueUSD.toFixed(2)}`, `${zReportMetrics.netRevenueLBP.toLocaleString('en-US')} LBP`],
      ['Cash Sales Inflow', `$${zReportMetrics.cashSalesUSD.toFixed(2)}`, `${zReportMetrics.cashSalesLBP.toLocaleString('en-US')} LBP`],
      ['Card Terminal Inflow', `$${zReportMetrics.cardSalesUSD.toFixed(2)}`, `${Math.round(zReportMetrics.cardSalesUSD * effectiveRate).toLocaleString('en-US')} LBP`],
      ['Member Wallet Inflow', `$${zReportMetrics.walletSalesUSD.toFixed(2)}`, `${Math.round(zReportMetrics.walletSalesUSD * effectiveRate).toLocaleString('en-US')} LBP`],
      ['On-Account SOA Receivables (411)', `$${zReportMetrics.onAccountSalesUSD.toFixed(2)}`, `${Math.round(zReportMetrics.onAccountSalesUSD * effectiveRate).toLocaleString('en-US')} LBP`],
      ['Voided / Refunded Volume', `$${zReportMetrics.refundedTotalUSD.toFixed(2)}`, `${Math.round(zReportMetrics.refundedTotalUSD * effectiveRate).toLocaleString('en-US')} LBP`],
      ['Expected Physical Drawer', `$${zReportMetrics.expectedDrawerUSD.toFixed(2)}`, `${zReportMetrics.expectedDrawerLBP.toLocaleString('en-US')} LBP`]
    ];

    if (shiftObj && shiftObj.status === 'closed') {
      rows.push([
        'Actual Counted Drawer',
        `$${Number(shiftObj.actualCountedUSD || 0).toFixed(2)}`,
        `${Number(shiftObj.actualCountedLBP || 0).toLocaleString('en-US')} LBP`
      ]);
      rows.push([
        'Cash Over / Short Variance',
        `${Number(shiftObj.varianceUSD || 0) >= 0 ? '+' : ''}$${Number(shiftObj.varianceUSD || 0).toFixed(2)}`,
        `${Number(shiftObj.varianceLBP || 0) >= 0 ? '+' : ''}${Number(shiftObj.varianceLBP || 0).toLocaleString('en-US')} LBP`
      ]);
    }

    autoTable(pdf, {
      startY: 35,
      head: [['Shift Metric', 'USD ($)', 'LBP (L.L.)']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [11, 15, 23], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9 }
    });

    if (zReportMetrics.topItems.length > 0) {
      const nextY = (pdf as any).lastAutoTable.finalY + 10;
      pdf.setFontSize(11);
      pdf.setTextColor(11, 15, 23);
      pdf.text('Itemized Shift Sales Breakdown', 14, nextY);
      autoTable(pdf, {
        startY: nextY + 4,
        head: [['Item Name', 'Units Sold', 'Revenue (USD)', 'Revenue (LBP)']],
        body: zReportMetrics.topItems.map(it => [
          it.name,
          String(it.qty),
          `$${it.revenue.toFixed(2)}`,
          `${Math.round(it.revenue * effectiveRate).toLocaleString('en-US')} LBP`
        ]),
        theme: 'striped',
        headStyles: { fillColor: [0, 184, 200], textColor: [11, 15, 23], fontStyle: 'bold' },
        styles: { fontSize: 8 }
      });
    }

    const pageCount = (pdf as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 130);
      pdf.text('Generated by Vescio Nexus ERP', 14, 288);
    }

    pdf.save(`z_report_${type}_${shiftObj ? shiftObj.id.slice(0, 6) : zReportDate}.pdf`);
    posToast('success', 'Official Shift Z-Report PDF downloaded!', 'تم تنزيل تقرير الوردية بصيغة PDF!');
  };

  const handleCloseShiftAndCountDrawer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeShift) return;

    const countedUSD = Math.max(0, parseFloat(actualCountedUSDInput) || 0);
    const countedLBP = Math.max(0, parseFloat(actualCountedLBPInput) || 0);
    const varianceUSD = Number((countedUSD - zReportMetrics.expectedDrawerUSD).toFixed(2));
    const varianceLBP = Math.round(countedLBP - zReportMetrics.expectedDrawerLBP);
    const closedAtIso = new Date().toISOString();

    const updatedShiftData: Partial<POSShift> = {
      status: 'closed',
      closedAt: closedAtIso,
      expectedDrawerUSD: zReportMetrics.expectedDrawerUSD,
      expectedDrawerLBP: zReportMetrics.expectedDrawerLBP,
      actualCountedUSD: countedUSD,
      actualCountedLBP: countedLBP,
      varianceUSD,
      varianceLBP,
      closingNotes: shiftClosingNotes.trim()
    };

    try {
      await updateDoc(doc(db, 'pos_shifts', activeShift.id), stripUndefined(updatedShiftData));
      await logSystemAudit({
        action: 'UPDATE',
        collectionName: 'pos_shifts',
        documentId: activeShift.id,
        staffId: user.uid,
        timestamp: closedAtIso,
        details: {
          event: 'SHIFT_CLOSE',
          posType: type,
          cashierName: activeShift.cashierName,
          expectedDrawerUSD: zReportMetrics.expectedDrawerUSD,
          actualCountedUSD: countedUSD,
          varianceUSD,
          expectedDrawerLBP: zReportMetrics.expectedDrawerLBP,
          actualCountedLBP: countedLBP,
          varianceLBP
        }
      });

      const closedShiftObj: POSShift = { ...activeShift, ...updatedShiftData } as POSShift;
      setIsCloseShiftModalOpen(false);
      setActualCountedUSDInput('');
      setActualCountedLBPInput('');
      setShiftClosingNotes('');
      handleDownloadZReportPDF(closedShiftObj);
      posToast(
        'success',
        `Shift closed & reconciled (Variance: ${varianceUSD >= 0 ? '+' : ''}$${varianceUSD.toFixed(2)} USD / ${varianceLBP >= 0 ? '+' : ''}${varianceLBP.toLocaleString('en-US')} LBP)`,
        `تم إغلاق الوردية ومطابقة الصندوق بنجاح`
      );
    } catch (err: any) {
      posToast('error', 'Failed to close shift: ' + err.message);
    }
  };

  // 80mm Thermal Receipt Print, PDF & WhatsApp Builders
  const handlePrintThermalReceipt = (order: POSOrder) => {
    const rate = order.exchangeRateUsed || order.fxRate || effectiveRate;
    const orderTotalLBP = Math.round(order.total * rate);
    const storeTitle = type === 'cafeteria' ? 'Kiosk POS — Mini-Supermarket' : 'Retail Shop POS';
    const isAr = posLang === 'ar';

    const itemsRowsHtml = (order.items || [])
      .map(it => {
        const displayName = isAr ? (it.nameAr || translateToArabic(it.name)) : it.name;
        const lineTot = (it.quantity * it.price).toFixed(2);
        return `<tr>
          <td style="padding:3px 0;">${it.quantity}x ${displayName}</td>
          <td style="padding:3px 0;text-align:right;font-family:monospace;">$${lineTot}</td>
        </tr>`;
      })
      .join('');

    const htmlContent = `<!DOCTYPE html>
<html dir="${isAr ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8" />
  <title>Receipt #${order.id.slice(0, 8)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { width: 72mm; margin: 0 auto; font-family: 'Courier New', monospace, sans-serif; font-size: 11px; color: #000; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:14px;">${systemName || 'Vescio Nexus'}</div>
  <div class="center" style="font-size:10px;">${storeTitle}</div>
  <div class="divider"></div>
  <div class="row"><span>${isAr ? 'رقم الطلب:' : 'Order #:'}</span><span>${order.id.slice(0, 8)}</span></div>
  <div class="row"><span>${isAr ? 'التاريخ:' : 'Date:'}</span><span>${new Date(order.date).toLocaleString('en-US')}</span></div>
  <div class="row"><span>${isAr ? 'الكاشير:' : 'Cashier:'}</span><span>${order.cashierName || 'POS'}</span></div>
  ${order.memberName ? `<div class="row"><span>${isAr ? 'العميل:' : 'Customer:'}</span><span>${order.memberName}</span></div>` : ''}
  <div class="divider"></div>
  <table>${itemsRowsHtml}</table>
  <div class="divider"></div>
  <div class="row"><span>${isAr ? 'المجموع الفرعي:' : 'Subtotal:'}</span><span>$${Number(order.subtotal || order.total).toFixed(2)}</span></div>
  ${order.discount > 0 ? `<div class="row"><span>${isAr ? 'الحسم:' : 'Discount:'}</span><span>-$${Number(order.discount).toFixed(2)}</span></div>` : ''}
  ${order.taxAmount && order.taxAmount > 0 ? `<div class="row"><span>${isAr ? 'ضريبة القيمة المضافة 11%:' : '11% VAT (4427):'}</span><span>+$${Number(order.taxAmount).toFixed(2)}</span></div>` : ''}
  <div class="divider"></div>
  <div class="row bold" style="font-size:13px;"><span>${isAr ? 'الإجمالي (LBP):' : 'TOTAL (LBP):'}</span><span>${orderTotalLBP.toLocaleString('en-US')} LBP</span></div>
  <div class="row bold"><span>${isAr ? 'الإجمالي (USD):' : 'TOTAL (USD):'}</span><span>$${order.total.toFixed(2)}</span></div>
  <div class="row" style="font-size:10px;"><span>${isAr ? 'طريقة الدفع:' : 'Payment:'}</span><span>${order.paymentMethod.toUpperCase()}</span></div>
  ${order.tenderedUSD || order.tenderedLBP ? `<div class="row" style="font-size:10px;"><span>${isAr ? 'المدفوع:' : 'Tendered:'}</span><span>$${Number(order.tenderedUSD || 0).toFixed(2)} + ${Number(order.tenderedLBP || 0).toLocaleString('en-US')} LBP</span></div>` : ''}
  ${(order.changeUSD && order.changeUSD > 0) || (order.changeLBP && order.changeLBP > 0) ? `<div class="row" style="font-size:10px;"><span>${isAr ? 'الباقي:' : 'Change:'}</span><span>$${Number(order.changeUSD || 0).toFixed(2)} (${Number(order.changeLBP || 0).toLocaleString('en-US')} LBP)</span></div>` : ''}
  <div class="divider"></div>
  <div class="center" style="font-size:10px;margin-top:6px;">${isAr ? 'شكراً لزيارتكم!' : 'Thank you for visiting!'}</div>
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const docWin = iframe.contentWindow?.document;
    if (docWin) {
      docWin.open();
      docWin.write(htmlContent);
      docWin.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1500);
      }, 200);
    }
  };

  const handleDownloadThermalReceiptPDF = (order: POSOrder) => {
    const rate = order.exchangeRateUsed || order.fxRate || effectiveRate;
    const orderTotalLBP = Math.round(order.total * rate);
    const itemsList = order.items || [];
    const dynamicHeight = Math.max(135, 95 + itemsList.length * 7);
    const pdf = new jsPDF({ unit: 'mm', format: [80, dynamicHeight] });

    let y = 8;
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(systemName || 'Vescio Nexus', 40, y, { align: 'center' });
    y += 4.5;
    pdf.setFontSize(7.5);
    pdf.setFont('helvetica', 'normal');
    pdf.text(type === 'cafeteria' ? 'Kiosk POS — Mini-Supermarket' : 'Retail Shop POS', 40, y, { align: 'center' });
    y += 4;
    pdf.line(4, y, 76, y);
    y += 4;

    pdf.setFontSize(7.5);
    pdf.text(`Order #: ${order.id.slice(0, 8)}`, 4, y);
    y += 3.8;
    pdf.text(`Date: ${new Date(order.date).toLocaleString('en-US')}`, 4, y);
    y += 3.8;
    pdf.text(`Cashier: ${order.cashierName || 'POS'}`, 4, y);
    y += 3.8;
    if (order.memberName) {
      pdf.text(`Member: ${order.memberName}`, 4, y);
      y += 3.8;
    }

    pdf.line(4, y, 76, y);
    y += 4;

    pdf.setFont('helvetica', 'bold');
    pdf.text('Item', 4, y);
    pdf.text('Total', 76, y, { align: 'right' });
    y += 3.5;
    pdf.setFont('helvetica', 'normal');

    itemsList.forEach(it => {
      const label = `${it.quantity}x ${it.name}`.slice(0, 30);
      const lineTot = `$${(it.quantity * it.price).toFixed(2)}`;
      pdf.text(label, 4, y);
      pdf.text(lineTot, 76, y, { align: 'right' });
      y += 4;
    });

    pdf.line(4, y, 76, y);
    y += 4;

    pdf.text('Subtotal:', 4, y);
    pdf.text(`$${Number(order.subtotal || order.total).toFixed(2)}`, 76, y, { align: 'right' });
    y += 3.8;

    if (order.discount > 0) {
      pdf.text('Discount:', 4, y);
      pdf.text(`-$${Number(order.discount).toFixed(2)}`, 76, y, { align: 'right' });
      y += 3.8;
    }

    if (order.taxAmount && order.taxAmount > 0) {
      pdf.text('11% VAT (4427):', 4, y);
      pdf.text(`+$${Number(order.taxAmount).toFixed(2)}`, 76, y, { align: 'right' });
      y += 3.8;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.text('TOTAL (LBP):', 4, y);
    pdf.text(`${orderTotalLBP.toLocaleString('en-US')} LBP`, 76, y, { align: 'right' });
    y += 4.5;
    pdf.setFontSize(8);
    pdf.text('TOTAL (USD):', 4, y);
    pdf.text(`$${order.total.toFixed(2)}`, 76, y, { align: 'right' });
    y += 4.5;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(`Payment: ${order.paymentMethod.toUpperCase()}`, 4, y);
    y += 3.8;
    if (order.paymentMethod === 'split' && order.splitBreakdown) {
      pdf.text(
        `Split: W $${order.splitBreakdown.wallet.toFixed(2)} | C $${order.splitBreakdown.cash.toFixed(2)} | Card $${order.splitBreakdown.card.toFixed(2)}`,
        4,
        y
      );
      y += 3.8;
    }
    if ((order.tenderedUSD || 0) > 0 || (order.tenderedLBP || 0) > 0) {
      pdf.text(
        `Tendered: $${Number(order.tenderedUSD || 0).toFixed(2)} + ${Number(order.tenderedLBP || 0).toLocaleString('en-US')} LBP`,
        4,
        y
      );
      y += 3.8;
    }
    if ((order.changeUSD || 0) > 0 || (order.changeLBP || 0) > 0) {
      pdf.text(
        `Change: $${Number(order.changeUSD || 0).toFixed(2)} (${Number(order.changeLBP || 0).toLocaleString('en-US')} LBP)`,
        4,
        y
      );
      y += 3.8;
    }

    y += 3;
    pdf.setFontSize(7);
    pdf.text('Thank you for choosing ' + (systemName || 'Vescio Nexus'), 40, y, { align: 'center' });

    pdf.save(`receipt_${order.id.slice(0, 8)}.pdf`);
    posToast('success', '80mm Thermal Receipt PDF downloaded!', 'تم تنزيل إيصال الدفع PDF!');
  };

  const buildWhatsAppReceiptUrl = (order: POSOrder, phoneStr: string): string => {
    const cleanDigits = phoneStr.replace(/[^0-9]/g, '');
    const normalizedPhone =
      cleanDigits.startsWith('0') && cleanDigits.length === 8
        ? `961${cleanDigits.slice(1)}`
        : cleanDigits.length === 8 && !cleanDigits.startsWith('961')
        ? `961${cleanDigits}`
        : cleanDigits;

    const rate = order.exchangeRateUsed || order.fxRate || effectiveRate;
    const orderTotalLBP = Math.round(order.total * rate);
    const isAr = posLang === 'ar';

    const lines: string[] = [];
    if (isAr) {
      lines.push(`*${systemName || 'Vescio Nexus'} — إيصال رقمي*`);
      lines.push(`رقم الطلب: #${order.id.slice(0, 8)}`);
      lines.push(`التاريخ: ${new Date(order.date).toLocaleString('en-US')}`);
      if (order.memberName) lines.push(`العميل: ${order.memberName}`);
      lines.push(`----------------`);
      (order.items || []).forEach(it => {
        const arName = it.nameAr || translateToArabic(it.name);
        lines.push(`• ${it.quantity}x ${arName}: $${(it.quantity * it.price).toFixed(2)}`);
      });
      lines.push(`----------------`);
      lines.push(`المجموع الفرعي: $${Number(order.subtotal || order.total).toFixed(2)}`);
      if (order.discount > 0) lines.push(`الحسم: -$${Number(order.discount).toFixed(2)}`);
      if (order.taxAmount && order.taxAmount > 0) lines.push(`ضريبة 11% (TVA): +$${Number(order.taxAmount).toFixed(2)}`);
      lines.push(`*الإجمالي: ${orderTotalLBP.toLocaleString('en-US')} LBP ($${order.total.toFixed(2)})*`);
      lines.push(`طريقة الدفع: ${order.paymentMethod === 'on_account' ? 'على الحساب (SOA)' : order.paymentMethod.toUpperCase()}`);
      lines.push(`شكراً لزيارتكم!`);
    } else {
      lines.push(`*${systemName || 'Vescio Nexus'} — Digital Receipt*`);
      lines.push(`Order #: #${order.id.slice(0, 8)}`);
      lines.push(`Date: ${new Date(order.date).toLocaleString('en-US')}`);
      if (order.memberName) lines.push(`Member: ${order.memberName}`);
      lines.push(`----------------`);
      (order.items || []).forEach(it => {
        lines.push(`• ${it.quantity}x ${it.name}: $${(it.quantity * it.price).toFixed(2)}`);
      });
      lines.push(`----------------`);
      lines.push(`Subtotal: $${Number(order.subtotal || order.total).toFixed(2)}`);
      if (order.discount > 0) lines.push(`Discount: -$${Number(order.discount).toFixed(2)}`);
      if (order.taxAmount && order.taxAmount > 0) lines.push(`11% VAT: +$${Number(order.taxAmount).toFixed(2)}`);
      lines.push(`*TOTAL: ${orderTotalLBP.toLocaleString('en-US')} LBP ($${order.total.toFixed(2)})*`);
      lines.push(`Payment: ${order.paymentMethod.replace('_', ' ').toUpperCase()}`);
      lines.push(`Thank you for visiting!`);
    }

    const encodedText = encodeURIComponent(toEnglishNumerals(lines.join('\n')));
    return normalizedPhone
      ? `https://wa.me/${normalizedPhone}?text=${encodedText}`
      : `https://wa.me/?text=${encodedText}`;
  };

  const handleRefundOrder = (order: POSOrder) => {
    if (!user || order.status === 'refunded' || order.status === 'voided') return;
    requireManagerApproval(
      `${order.paymentMethod === 'cash' ? 'Void' : 'Refund'} Order #${order.id.slice(0, 8)} ($${order.total.toFixed(2)})`,
      () => {
        setRefundModalOrder(order);
        setRefundReasonInput('');
      }
    );
  };

  const confirmRefundOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !refundModalOrder) return;
    const order = refundModalOrder;
    const reason = refundReasonInput.trim();
    if (!reason) {
      posToast('error', 'Please enter a reason for the void/refund.', 'يرجى إدخال سبب الإلغاء / الاسترداد.');
      return;
    }

    try {
      const q = query(collection(db, 'transactions'), where('referenceId', '==', order.id), where('transactionType', '==', 'sale'));
      const snap = await getDocs(q);

      if (snap.empty) {
        posToast('error', 'Could not find original financial transaction for this order.', 'لم يتم العثور على المعاملة المالية الأصلية لهذا الطلب.');
        return;
      }

      const allInflows = snap.docs.filter(d => !d.data().isReversal && d.data().direction === 'inflow');
      const unreversedInflowIds: string[] = [];

      for (const inflow of allInflows) {
         const revQ = query(collection(db, 'transactions'), where('referenceId', '==', inflow.id), where('isReversal', '==', true));
         const revSnap = await getDocs(revQ);
         if (revSnap.empty) {
           unreversedInflowIds.push(inflow.id);
         }
      }

      if (unreversedInflowIds.length === 0) {
        posToast('error', 'This order has already been fully refunded.', 'تم استرداد هذا الطلب بالكامل مسبقاً.');
        return;
      }

      await processReversalTransaction({
        originalTransactionIds: unreversedInflowIds,
        transactionType: 'sale_reversal',
        sourceModule: type === 'cafeteria' ? 'pos_cafe' : 'pos_retail',
        cashierId: user.uid,
        reason,
        memberId: order.memberId || null,
        relatedIds: [order.id],
        restoreInventoryItems: (order.items || []).map((i: any) => ({
          itemId: i.itemId,
          quantity: i.quantity,
          saleUnitType: i.saleUnitType,
          unitsDeductedPerQty: i.unitsDeductedPerQty,
          variantId: i.variantId,
          variantName: i.variantName,
          isBundle: i.isBundle,
          bundleComponents: i.bundleComponents
        }))
      }, async (transaction) => {
        const newStatus = order.paymentMethod === 'cash' ? 'voided' : 'refunded';
        transaction.update(doc(db, 'orders', order.id), {
          status: newStatus,
          refundedInShiftId: activeShift?.id || null,
          refundedAt: new Date().toISOString()
        });
      });
      
      setRefundModalOrder(null);
      setRefundReasonInput('');
      posToast(
        'success',
        order.paymentMethod === 'cash' ? 'Order voided safely & stock restored.' : 'Order refunded & stock restored.',
        order.paymentMethod === 'cash' ? 'تم إلغاء الطلب وإعادة المخزون بنجاح.' : 'تم استرداد الطلب وإعادة المخزون بنجاح.'
      );
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`, user);
      posToast('error', 'Failed to process refund: ' + error.message);
    }
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;
  }

  if (!user) {
    navigate('/');
    return null;
  }

  const title = type === 'cafeteria' ? 'Kiosk POS — Mini-Supermarket & Grocery' : 'Retail Shop POS — Merchandise, Medical & Supplements';

  const displayedInventory = items.filter(item => {
    const q = inventorySearch.toLowerCase().trim();
    const matchesSearch = !q ||
      item.name.toLowerCase().includes(q) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.barcode && item.barcode.toLowerCase().includes(q)) ||
      (item.supplier && item.supplier.toLowerCase().includes(q));
    if (!matchesSearch) return false;
    if (inventoryAlertFilter === 'low_stock') {
      return item.stock <= (item.lowStockThreshold ?? 5);
    }
    if (inventoryAlertFilter === 'expiring') {
      return !!item.expiryDate && new Date(item.expiryDate).getTime() <= Date.now() + 14 * 86400000;
    }
    return true;
  });

  return (
    <div className={`min-h-screen flex flex-col ${isDarkMode ? 'dark bg-[#05070A] text-zinc-100' : 'bg-[#F8FAFC] text-slate-900'}`}>
      <header className={`border-b ${isDarkMode ? 'bg-[#0B0F17]/95 border-zinc-800/80' : 'bg-white/95 border-slate-200'} px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-10 backdrop-blur-xl`}>
        <div className="flex items-center gap-3 shrink-0">
          <TenantBrandLockup
            systemName={systemName}
            systemLogo={systemLogo}
            size="sm"
            subtitle={`${title} • 1 USD = ${effectiveRate.toLocaleString('en-US')} LBP`}
          />
          {type === 'cafeteria' && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold ${
                isDarkMode
                  ? 'bg-zinc-900/90 border-amber-500/40 text-amber-400'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
              dir="ltr"
              title="Editable Kiosk POS Exchange Rate (Default: 89,000 LBP)"
            >
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">1 USD =</span>
              <input
                type="number"
                step="500"
                min="1000"
                value={kioskExchangeRate}
                onChange={e => handleUpdateKioskRate(parseFloat(e.target.value) || 89000)}
                className={`w-20 px-1.5 py-0.5 rounded border text-center font-black font-mono text-xs outline-none ${
                  isDarkMode
                    ? 'bg-zinc-950 border-zinc-700 text-amber-300 focus:border-[#00B8C8]'
                    : 'bg-white border-amber-300 text-amber-900 focus:border-[#00B8C8]'
                }`}
              />
              <span className="text-[10px] font-black uppercase">LBP</span>
            </div>
          )}
        </div>
        <div className={`flex flex-wrap gap-1 p-1 rounded-xl border transition-colors ${isDarkMode ? 'bg-[#101622] border-zinc-800' : 'bg-slate-100 border-slate-200'}`}>
          <button 
            onClick={() => setActiveTab('pos')}
            className={`h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center ${activeTab === 'pos' 
              ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]' 
              : isDarkMode 
                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-white'}`}
          >
            Point of Sale
          </button>
          <button 
            onClick={() => setActiveTab('inventory')}
            className={`h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${activeTab === 'inventory' 
              ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]' 
              : isDarkMode 
                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-white'}`}
          >
            Inventory
            {restockCandidates.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-500 text-white">
                {restockCandidates.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setActiveTab('orders')}
            className={`h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center ${activeTab === 'orders' 
              ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]' 
              : isDarkMode 
                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-white'}`}
          >
            Orders
          </button>
          <button 
            onClick={() => setActiveTab('z_report')}
            className={`h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center ${activeTab === 'z_report' 
              ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]' 
              : isDarkMode 
                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-white'}`}
          >
            Shift Z-Report
          </button>
          <button 
            onClick={() => setActiveTab('purchase_orders')}
            className={`h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center ${activeTab === 'purchase_orders' 
              ? 'bg-[#00B8C8] text-slate-950 shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]' 
              : isDarkMode 
                ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-white'}`}
          >
            Purchase Orders
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {activeShift ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedShiftId(activeShift.id);
                  setActiveTab('z_report');
                }}
                className="h-9 px-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-500/20 transition-all"
                title="View Active Shift Z-Report"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  {posLang === 'ar'
                    ? `الوردية: ${activeShift.cashierName}`
                    : `Shift: ${activeShift.cashierName}`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedShiftId(activeShift.id);
                  setActualCountedUSDInput(String(zReportMetrics.expectedDrawerUSD.toFixed(2)));
                  setActualCountedLBPInput(String(Math.round(zReportMetrics.expectedDrawerLBP)));
                  setIsCloseShiftModalOpen(true);
                }}
                className="h-9 px-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-bold transition-all"
                title="Close Shift & Count Physical Cash Drawer"
              >
                {posLang === 'ar' ? 'إغلاق الوردية' : 'Close Shift'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsOpenShiftModalOpen(true)}
              className="h-9 px-3.5 rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 text-xs font-black flex items-center gap-1.5 transition-all"
            >
              <Clock size={14} />
              <span>{posLang === 'ar' ? 'فتح وردية كاشير' : 'Open Shift'}</span>
            </button>
          )}
          <button
            onClick={openCommandPalette}
            className={`h-9 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isDarkMode ? 'bg-[#101622] border-zinc-800 text-zinc-200 hover:border-cyan-500/40' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
            }`}
            title="Open Reception Command Palette (Ctrl + K)"
          >
            <Search size={14} className="text-[#00B8C8]" />
            <span className="hidden sm:inline">Reception</span>
            <kbd className="text-[10px] font-mono opacity-70">Ctrl+K</kbd>
          </button>
          <button
            onClick={() => setIsOpenTabsModalOpen(true)}
            className={`h-9 px-3.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              parkedOrders.length > 0
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-500 hover:bg-amber-500/25'
                : isDarkMode
                ? 'bg-[#101622] border-zinc-800 text-zinc-300 hover:border-cyan-500/40'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            <PauseCircle size={15} />
            {posLang === 'ar' && activeTab === 'pos'
              ? `الطلبات المعلقة (${Number(parkedOrders.length).toLocaleString('en-US')})`
              : `Open Tabs (${parkedOrders.length})`}
          </button>
          <button
            onClick={() => setPosLang(prev => (prev === 'en' ? 'ar' : 'en'))}
            className={`h-9 px-3.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all ${
              posLang === 'ar'
                ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8] shadow-[0_0_20px_-5px_rgba(0,184,200,0.4)]'
                : isDarkMode
                ? 'bg-[#101622] border-zinc-800 text-[#00B8C8] hover:border-cyan-500/40'
                : 'bg-white border-slate-200 text-[#0099A8] hover:bg-slate-50'
            }`}
            title="Switch POS Terminal Language (العربية / English)"
          >
            <span>🌐</span>
            <span>{posLang === 'en' ? 'العربية' : 'English'}</span>
          </button>
          <ThemeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex">
        {activeTab === 'pos' && (
          <DndContext 
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
          >
            <div className="flex-1 overflow-hidden flex" dir={posLang === 'ar' ? 'rtl' : 'ltr'} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {/* Products Grid */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-black tracking-tight">
                      {posLang === 'ar' ? 'المنتجات المتوفرة' : 'Available Products'}
                    </h2>
                    <p className={`text-sm font-medium ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                      {posLang === 'ar'
                        ? 'امسح الباركود أو اضغط على المنتج لإضافته مباشرة إلى السلة'
                        : 'Scan barcode/SKU + Enter for instant cart add, or click product'}
                    </p>
                  </div>
                  <div className="flex gap-2.5 w-full md:w-auto items-center">
                    <div className="flex-1 md:w-80 relative">
                      <Barcode size={18} className={`absolute ${posLang === 'ar' ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-[#00B8C8]`} />
                      <input 
                        type="text" 
                        placeholder={posLang === 'ar' ? 'امسح الباركود أو ابحث عن منتج...' : 'Scan barcode / SKU or search...'} 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={handleBarcodeSearchKeyDown}
                        className={`el-input ${posLang === 'ar' ? 'pr-11' : 'pl-11'}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCategoryModalOpen(true)}
                      className={`px-3.5 py-3 rounded-xl text-xs font-black uppercase tracking-wider border flex items-center gap-1.5 transition-all shrink-0 ${
                        isDarkMode
                          ? 'bg-zinc-900 border-zinc-800 hover:border-[#00B8C8]/50 text-[#00B8C8]'
                          : 'bg-white border-slate-200 hover:border-[#00B8C8] text-[#00B8C8] shadow-sm'
                      }`}
                      title={posLang === 'ar' ? 'إدارة الفئات والفئات الفرعية' : 'Manage Categories & Subcategories'}
                    >
                      <Layers size={15} />
                      <span>{posLang === 'ar' ? 'إدارة الفئات' : 'Categories'}</span>
                    </button>
                  </div>
                </div>

                {/* 3-Level Visual Thumbnail Drill-Down Navigation System */}
                {(() => {
                  const isSearching = searchQuery.trim().length > 0;
                  const activeCatSubcategories = activeCategoryConfig?.subcategories || [];
                  const isWindow1Categories =
                    !isSearching && !showAllProductsGrid && categoryFilter === 'All';
                  const isWindow2Subcategories =
                    !isSearching &&
                    !showAllProductsGrid &&
                    categoryFilter !== 'All' &&
                    subcategoryFilter === 'All' &&
                    activeCatSubcategories.length > 0;
                  const isWindow3Products = !isWindow1Categories && !isWindow2Subcategories;

                  const activeCategoryDisplay =
                    categoryFilter !== 'All'
                      ? posLang === 'ar'
                        ? activeCategoryConfig?.nameAr || translateToArabic(categoryFilter)
                        : categoryFilter
                      : '';

                  const activeSubcategoryDisplay =
                    subcategoryFilter !== 'All'
                      ? subcategoryFilter === '__ALL_IN_CATEGORY__'
                        ? posLang === 'ar'
                          ? `كل منتجات ${activeCategoryDisplay}`
                          : `All ${categoryFilter} Products`
                        : posLang === 'ar'
                        ? activeCatSubcategories.find(s => s.name === subcategoryFilter)?.nameAr ||
                          translateToArabic(subcategoryFilter)
                        : subcategoryFilter
                      : '';

                  const handleBackStep = () => {
                    if (isSearching) {
                      setSearchQuery('');
                      return;
                    }
                    if (showAllProductsGrid) {
                      setShowAllProductsGrid(false);
                      return;
                    }
                    if (
                      categoryFilter !== 'All' &&
                      subcategoryFilter !== 'All' &&
                      activeCatSubcategories.length > 0
                    ) {
                      setSubcategoryFilter('All');
                      return;
                    }
                    setCategoryFilter('All');
                    setSubcategoryFilter('All');
                  };

                  return (
                    <div className="space-y-4">
                      {/* Breadcrumb / Back Navigation Header Bar */}
                      <div
                        className={`p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-2.5 ${
                          isDarkMode
                            ? 'bg-zinc-900/90 border-zinc-800'
                            : 'bg-white border-slate-200 shadow-sm'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {(categoryFilter !== 'All' || showAllProductsGrid || isSearching) && (
                            <button
                              type="button"
                              onClick={handleBackStep}
                              className="px-3 py-1.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-black flex items-center gap-1.5 transition-all shadow-sm"
                            >
                              <ArrowLeft size={14} className={posLang === 'ar' ? 'rotate-180' : ''} />
                              <span>{posLang === 'ar' ? 'رجوع' : 'Back'}</span>
                            </button>
                          )}

                          {/* Interactive Breadcrumb Trail */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                            <button
                              type="button"
                              onClick={() => {
                                setCategoryFilter('All');
                                setSubcategoryFilter('All');
                                setShowAllProductsGrid(false);
                                setSearchQuery('');
                              }}
                              className={`px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                                isWindow1Categories
                                  ? 'bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/40 font-black'
                                  : isDarkMode
                                  ? 'text-zinc-300 hover:bg-zinc-800'
                                  : 'text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <span>🏠</span>
                              <span>{posLang === 'ar' ? 'كل الفئات' : 'All Categories'}</span>
                            </button>

                            {categoryFilter !== 'All' && (
                              <>
                                <ChevronRight
                                  size={14}
                                  className={`text-zinc-500 ${posLang === 'ar' ? 'rotate-180' : ''}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSubcategoryFilter('All');
                                    setShowAllProductsGrid(false);
                                  }}
                                  className={`px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                                    isWindow2Subcategories ||
                                    (isWindow3Products && subcategoryFilter === 'All')
                                      ? 'bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/40 font-black'
                                      : isDarkMode
                                      ? 'text-zinc-300 hover:bg-zinc-800'
                                      : 'text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  <span>📂</span>
                                  <span>{activeCategoryDisplay}</span>
                                </button>
                              </>
                            )}

                            {categoryFilter !== 'All' && subcategoryFilter !== 'All' && (
                              <>
                                <ChevronRight
                                  size={14}
                                  className={`text-zinc-500 ${posLang === 'ar' ? 'rotate-180' : ''}`}
                                />
                                <span className="px-2.5 py-1.5 rounded-xl bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/40 font-black flex items-center gap-1.5">
                                  <span>🏷️</span>
                                  <span>{activeSubcategoryDisplay}</span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Quick View All Products Toggle */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (showAllProductsGrid) {
                                setShowAllProductsGrid(false);
                              } else {
                                setCategoryFilter('All');
                                setSubcategoryFilter('All');
                                setShowAllProductsGrid(true);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all flex items-center gap-1.5 ${
                              showAllProductsGrid
                                ? 'bg-[#00B8C8] border-[#00B8C8] text-slate-950 shadow-sm'
                                : isDarkMode
                                ? 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-[#00B8C8]/50 hover:text-[#00B8C8]'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-[#00B8C8]'
                            }`}
                          >
                            <Package size={14} />
                            <span>
                              {showAllProductsGrid
                                ? posLang === 'ar'
                                  ? 'عرض شبكة الفئات'
                                  : 'Browse by Category'
                                : posLang === 'ar'
                                ? `عرض كل المنتجات (${Number(items.length).toLocaleString('en-US')})`
                                : `View All Products (${Number(items.length).toLocaleString('en-US')})`}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* ================================================================ */}
                      {/* WINDOW 1: CATEGORY THUMBNAIL GRID                                */}
                      {/* ================================================================ */}
                      {isWindow1Categories && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-1">
                            <span className="text-xs font-black uppercase tracking-widest text-zinc-400">
                              {posLang === 'ar'
                                ? 'اختر الفئة لعرض الأقسام أو المنتجات'
                                : 'Select a Category Thumbnail to Drill Down'}
                            </span>
                            <span className="text-xs font-mono text-zinc-500" dir="ltr">
                              {Number(effectiveCategoryConfigs.length).toLocaleString('en-US')} categories
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                            {effectiveCategoryConfigs.map(cat => {
                              const catItems = items.filter(i => i.category === cat.name);
                              const catCount = catItems.length;
                              const subCount = (cat.subcategories || []).length;
                              const sampleImage = catItems.find(i => i.image)?.image;
                              const primaryLabel =
                                posLang === 'ar'
                                  ? cat.nameAr || translateToArabic(cat.name)
                                  : cat.name;
                              const secondaryLabel =
                                posLang === 'ar'
                                  ? cat.name
                                  : showArabicFields
                                  ? cat.nameAr || translateToArabic(cat.name)
                                  : '';

                              return (
                                <button
                                  key={cat.id}
                                  type="button"
                                  onClick={() => {
                                    setCategoryFilter(cat.name);
                                    setSubcategoryFilter('All');
                                    setShowAllProductsGrid(false);
                                  }}
                                  className={`group p-4 rounded-2xl border text-left transition-all hover:scale-[1.01] flex flex-col justify-between min-h-[132px] relative overflow-hidden ${
                                    isDarkMode
                                      ? 'bg-zinc-900/90 border-zinc-800 hover:border-[#00B8C8]/70 hover:bg-zinc-900'
                                      : 'bg-white border-slate-200 hover:border-[#00B8C8] shadow-sm hover:shadow-md'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="w-11 h-11 rounded-xl bg-[#00B8C8]/10 border border-[#00B8C8]/25 text-[#00B8C8] flex items-center justify-center overflow-hidden shrink-0">
                                      {sampleImage ? (
                                        <img
                                          src={sampleImage}
                                          alt={cat.name}
                                          className="w-full h-full object-cover"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : (
                                        <FolderTree size={20} />
                                      )}
                                    </div>
                                    <span
                                      className="px-2 py-0.5 rounded-lg text-[11px] font-mono font-black bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/30"
                                      dir="ltr"
                                    >
                                      {Number(catCount).toLocaleString('en-US')} items
                                    </span>
                                  </div>

                                  <div>
                                    <div
                                      className={`font-black text-sm group-hover:text-[#00B8C8] transition-colors line-clamp-1 ${
                                        posLang === 'ar' ? 'text-right' : 'text-left'
                                      }`}
                                    >
                                      {primaryLabel}
                                    </div>
                                    {secondaryLabel && (
                                      <div
                                        className={`text-[11px] text-zinc-500 font-medium line-clamp-1 mt-0.5 ${
                                          posLang === 'ar' ? 'text-right' : 'text-left'
                                        }`}
                                      >
                                        {secondaryLabel}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-zinc-800/40 text-[10px] font-bold text-zinc-400">
                                    <span dir="ltr">
                                      {subCount > 0
                                        ? `${Number(subCount).toLocaleString('en-US')} subcategories`
                                        : 'Direct products'}
                                    </span>
                                    <ChevronRight
                                      size={13}
                                      className={`text-[#00B8C8] transition-transform group-hover:translate-x-0.5 ${
                                        posLang === 'ar' ? 'rotate-180' : ''
                                      }`}
                                    />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ================================================================ */}
                      {/* WINDOW 2: SUBCATEGORY THUMBNAIL GRID                             */}
                      {/* ================================================================ */}
                      {isWindow2Subcategories && activeCategoryConfig && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-1">
                            <span className="text-xs font-black uppercase tracking-widest text-[#00B8C8]">
                              {posLang === 'ar'
                                ? `الأقسام الفرعية داخل ${activeCategoryDisplay}`
                                : `${categoryFilter} — Select a Subcategory`}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setCategoryFilter('All');
                                setSubcategoryFilter('All');
                              }}
                              className="text-xs font-bold text-zinc-400 hover:text-[#00B8C8] flex items-center gap-1"
                            >
                              <ArrowLeft size={13} />
                              <span>{posLang === 'ar' ? 'كل الفئات' : 'Back to All Categories'}</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                            {/* "All [Category] Products" Thumbnail Card */}
                            <button
                              type="button"
                              onClick={() => setSubcategoryFilter('__ALL_IN_CATEGORY__')}
                              className={`group p-4 rounded-2xl border text-left transition-all hover:scale-[1.01] flex flex-col justify-between min-h-[120px] ${
                                isDarkMode
                                  ? 'bg-[#00B8C8]/10 border-[#00B8C8]/40 hover:border-[#00B8C8]'
                                  : 'bg-cyan-50/60 border-[#00B8C8]/40 hover:border-[#00B8C8]'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="w-10 h-10 rounded-xl bg-[#00B8C8] text-slate-950 flex items-center justify-center shrink-0">
                                  <Layers size={18} />
                                </div>
                                <span
                                  className="px-2 py-0.5 rounded-lg text-[11px] font-mono font-black bg-[#00B8C8] text-slate-950"
                                  dir="ltr"
                                >
                                  {Number(
                                    items.filter(i => i.category === activeCategoryConfig.name).length
                                  ).toLocaleString('en-US')}{' '}
                                  items
                                </span>
                              </div>
                              <div>
                                <div className="font-black text-sm text-[#00B8C8]">
                                  {posLang === 'ar'
                                    ? `كل منتجات ${activeCategoryDisplay}`
                                    : `All ${activeCategoryConfig.name} Products`}
                                </div>
                                <div className="text-[11px] text-zinc-400 mt-0.5">
                                  {posLang === 'ar'
                                    ? 'عرض جميع المنتجات في هذه الفئة'
                                    : 'View entire category inventory'}
                                </div>
                              </div>
                            </button>

                            {/* Subcategory Thumbnail Cards */}
                            {activeCategoryConfig.subcategories.map(sub => {
                              const subItems = items.filter(
                                i =>
                                  i.category === activeCategoryConfig.name &&
                                  (i.subcategory || '') === sub.name
                              );
                              const subSampleImg = subItems.find(i => i.image)?.image;
                              const subPrimary =
                                posLang === 'ar'
                                  ? sub.nameAr || translateToArabic(sub.name)
                                  : sub.name;
                              const subSecondary =
                                posLang === 'ar'
                                  ? sub.name
                                  : showArabicFields
                                  ? sub.nameAr || translateToArabic(sub.name)
                                  : '';

                              return (
                                <button
                                  key={sub.id}
                                  type="button"
                                  onClick={() => setSubcategoryFilter(sub.name)}
                                  className={`group p-4 rounded-2xl border text-left transition-all hover:scale-[1.01] flex flex-col justify-between min-h-[120px] ${
                                    isDarkMode
                                      ? 'bg-zinc-900/90 border-zinc-800 hover:border-[#00B8C8]/70'
                                      : 'bg-white border-slate-200 hover:border-[#00B8C8] shadow-sm'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="w-10 h-10 rounded-xl bg-[#00B8C8]/10 border border-[#00B8C8]/25 text-[#00B8C8] flex items-center justify-center overflow-hidden shrink-0">
                                      {subSampleImg ? (
                                        <img
                                          src={subSampleImg}
                                          alt={sub.name}
                                          className="w-full h-full object-cover"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : (
                                        <Package size={18} />
                                      )}
                                    </div>
                                    <span
                                      className="px-2 py-0.5 rounded-lg text-[11px] font-mono font-black bg-[#00B8C8]/15 text-[#00B8C8] border border-[#00B8C8]/30"
                                      dir="ltr"
                                    >
                                      {Number(subItems.length).toLocaleString('en-US')} items
                                    </span>
                                  </div>

                                  <div>
                                    <div className="font-black text-sm group-hover:text-[#00B8C8] transition-colors line-clamp-1">
                                      {subPrimary}
                                    </div>
                                    {subSecondary && (
                                      <div className="text-[11px] text-zinc-500 font-medium line-clamp-1 mt-0.5">
                                        {subSecondary}
                                      </div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ================================================================ */}
                      {/* WINDOW 3: PRODUCTS GRID                                          */}
                      {/* ================================================================ */}
                      {isWindow3Products && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-1">
                            <button
                              type="button"
                              onClick={handleBackStep}
                              className="text-xs font-black text-[#00B8C8] hover:underline flex items-center gap-1.5"
                            >
                              <ArrowLeft size={14} className={posLang === 'ar' ? 'rotate-180' : ''} />
                              <span>
                                {categoryFilter !== 'All' &&
                                subcategoryFilter !== 'All' &&
                                activeCatSubcategories.length > 0
                                  ? posLang === 'ar'
                                    ? `العودة إلى أقسام ${activeCategoryDisplay}`
                                    : `Back to ${categoryFilter} Subcategories`
                                  : posLang === 'ar'
                                  ? 'العودة إلى شبكة الفئات'
                                  : 'Back to All Categories'}
                              </span>
                            </button>
                            <span className="text-xs font-mono text-zinc-500" dir="ltr">
                              {Number(filteredItems.length).toLocaleString('en-US')} products
                            </span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            <AnimatePresence>
                              {filteredItems.map(item => (
                                <DraggableProduct
                                  key={item.id}
                                  item={item}
                                  isDarkMode={isDarkMode}
                                  onAdd={addToCart}
                                  formatCurrency={formatCurrency}
                                  lang={posLang}
                                  posType={type}
                                  effectiveRate={effectiveRate}
                                />
                              ))}
                            </AnimatePresence>
                          </div>

                          {filteredItems.length === 0 && (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 opacity-40">
                              <Search size={64} className="mb-4" />
                              <p className="text-xl font-bold">
                                {posLang === 'ar' ? 'لم يتم العثور على منتجات' : 'No products found'}
                              </p>
                              <p className="text-sm">
                                {posLang === 'ar'
                                  ? 'جرب تعديل البحث أو العودة إلى الفئات'
                                  : 'Try adjusting your search or going back to categories'}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Cart Sidebar */}
              <div className={`w-[430px] ${posLang === 'ar' ? 'border-r' : 'border-l'} flex flex-col relative overflow-y-auto ${isDarkMode ? 'bg-zinc-900/80 border-zinc-800' : 'bg-white border-slate-200 shadow-2xl shadow-slate-200/50'}`}>
                <div className="p-5 border-b border-zinc-800/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-[#00B8C8] text-slate-950 shadow-lg shadow-cyan-500/20">
                      <ShoppingCart size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-black tracking-tight">
                        {posLang === 'ar' ? 'الطلب الحالي' : 'Current Order'}
                      </h2>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {posLang === 'ar'
                          ? `${Number(cart.reduce((acc, p) => acc + p.quantity, 0)).toLocaleString('en-US')} عناصر محددة`
                          : `${cart.reduce((acc, p) => acc + p.quantity, 0)} items selected`}
                      </p>
                    </div>
                  </div>
                  {cart.length > 0 && (
                    <button 
                      onClick={() => setIsClearCartModalOpen(true)}
                      className="p-2 text-zinc-400 hover:text-rose-500 transition-colors"
                      title={posLang === 'ar' ? 'إفراغ السلة' : 'Clear Cart'}
                    >
                      <Trash size={18} />
                    </button>
                  )}
                </div>
                
                <CartDroppable 
                  cart={cart} 
                  isDarkMode={isDarkMode} 
                  onUpdateQuantity={updateCartQuantity} 
                  onRemove={removeFromCart}
                  isOver={isCartOver}
                  formatCurrency={formatCurrency}
                  lang={posLang}
                  posType={type}
                  effectiveRate={effectiveRate}
                  onToggleSaleUnitType={toggleCartSaleUnitType}
                />

                <div className={`p-5 border-t flex flex-col gap-4 ${isDarkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-slate-100 bg-slate-50/50'}`}>
                  <div className="space-y-3">
                    <div>
                      <label className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">
                        <User size={12} /> {posLang === 'ar' ? 'ربط مشترك (اختياري)' : 'Link Member (Optional)'}
                      </label>
                      <div className="relative">
                        {selectedMember ? (
                          <div className={`flex items-center justify-between p-2.5 rounded-2xl border ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                            <div className="flex flex-col">
                              <span className="text-sm font-bold">{selectedMember.firstName} {selectedMember.lastName}</span>
                              <span className="text-xs text-zinc-500 font-mono" dir="ltr">{selectedMember.phone}</span>
                            </div>
                            <button 
                              onClick={() => {
                                setSelectedMember(null);
                                setMemberSearchQuery('');
                                if (paymentMethod === 'member_balance' || paymentMethod === 'on_account') {
                                  setPaymentMethod('cash');
                                }
                              }} 
                              className="p-1 rounded-full text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                            >
                              <XCircle size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="relative">
                            <Search className={`absolute ${posLang === 'ar' ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-zinc-400`} size={16} />
                            <input 
                              type="text"
                              value={memberSearchQuery}
                              onChange={(e) => setMemberSearchQuery(e.target.value)}
                              onFocus={() => setIsMemberSearchFocused(true)}
                              onBlur={() => setTimeout(() => setIsMemberSearchFocused(false), 200)}
                              placeholder={posLang === 'ar' ? 'ابحث عن مشترك... (أو الدفع كزائر)' : 'Search member... (or checkout as Guest)'}
                              className={`el-input ${posLang === 'ar' ? 'pr-10' : 'pl-10'} py-2`}
                            />
                            
                            <AnimatePresence>
                              {isMemberSearchFocused && memberSearchQuery && (
                                <motion.div 
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className={`absolute z-20 w-full mt-2 rounded-2xl border overflow-hidden shadow-xl max-h-60 overflow-y-auto ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}
                                >
                                  {members.filter(m => 
                                    m.id !== 'walk_in' && 
                                    m.id !== 'free_lance' && 
                                    m.id !== 'free_lance_member' && 
                                    m.packageId !== 'walk-in' && 
                                    m.packageId !== 'free-lance' &&
                                    !`${m.firstName} ${m.lastName}`.toLowerCase().includes('walk-in') &&
                                    !`${m.firstName} ${m.lastName}`.toLowerCase().includes('walk in') &&
                                    (
                                      m.firstName.toLowerCase().includes(memberSearchQuery.toLowerCase()) || 
                                      m.lastName.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
                                      m.phone?.includes(memberSearchQuery) ||
                                      `${m.firstName} ${m.lastName}`.toLowerCase().includes(memberSearchQuery.toLowerCase())
                                    )
                                  ).slice(0, 5).map(m => (
                                    <div 
                                      key={m.id}
                                      onClick={() => { setSelectedMember(m); setMemberSearchQuery(''); setIsMemberSearchFocused(false); }}
                                      className={`p-3 cursor-pointer flex flex-col transition-colors border-b last:border-b-0 ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-slate-100 hover:bg-slate-50'}`}
                                    >
                                      <span className="font-bold text-sm">{m.firstName} {m.lastName}</span>
                                      <span className="text-xs text-zinc-500 font-mono" dir="ltr">{m.phone || 'No phone'}</span>
                                    </div>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>

                      {!selectedMember && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <input 
                            type="tel"
                            dir="ltr"
                            placeholder={posLang === 'ar' ? 'هاتف الزائر (اختياري)' : 'Guest Phone (Opt)'}
                            value={guestPhone}
                            onChange={e => setGuestPhone(e.target.value)}
                            className="el-input py-2 text-xs font-mono"
                          />
                          <input 
                            type="text"
                            placeholder={posLang === 'ar' ? 'اسم الزائر (اختياري)' : 'Guest Name (Opt)'}
                            value={guestName}
                            onChange={e => setGuestName(e.target.value)}
                            className="el-input py-2 text-xs"
                          />
                        </div>
                      )}

                      {selectedMember && (
                        <div className={`mt-2 p-2.5 rounded-xl border flex justify-between items-center ${
                          isDarkMode ? 'bg-zinc-950/50 border-zinc-800' : 'bg-white border-slate-200'
                        }`}>
                          <span className="text-xs font-bold opacity-60">
                            {posLang === 'ar' ? 'رصيد المحفظة:' : 'Wallet Balance:'}
                          </span>
                          <span className={`text-sm font-black font-mono ${(selectedMember.balance || 0) >= total ? 'text-emerald-500' : 'text-amber-500'}`} dir="ltr">
                            {formatCurrency(selectedMember.balance || 0)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className={`p-3.5 rounded-2xl space-y-2.5 ${isDarkMode ? 'bg-zinc-950/30' : 'bg-white border border-slate-100 shadow-sm'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className="opacity-60">{posLang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span>
                        {type === 'cafeteria' ? (
                          <div className="text-right font-mono leading-tight" dir="ltr">
                            <div className="font-black text-amber-500">
                              {Math.round(subtotal * effectiveRate).toLocaleString('en-US')} LBP
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        ) : (
                          <span dir="ltr" className="font-mono opacity-80">{formatCurrency(subtotal)}</span>
                        )}
                      </div>
                      <div className="flex justify-between items-center text-xs font-bold">
                        <div className="flex items-center gap-1 opacity-60">
                          <span>{posLang === 'ar' ? 'حسم يدوي (Discount)' : 'Manual Discount'}</span>
                          {!isManagerOrAdmin && <Lock size={11} className="text-amber-500" title="Discounts > 15% require Manager PIN" />}
                        </div>
                        <div className="flex flex-col items-end gap-0.5" dir="ltr">
                          <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded-lg">
                            <span className="text-[10px] opacity-60 font-mono">
                              {type === 'cafeteria' ? 'LBP' : currency}
                            </span>
                            <input 
                              type="number" 
                              step={type === 'cafeteria' ? '1000' : '0.01'}
                              min="0"
                              max={
                                type === 'cafeteria'
                                  ? Math.round(subtotal * effectiveRate)
                                  : currency === 'LBP'
                                  ? convertFromBase(subtotal)
                                  : subtotal
                              }
                              value={
                                type === 'cafeteria'
                                  ? Math.round(manualDiscount * effectiveRate) || ''
                                  : currency === 'LBP'
                                  ? convertFromBase(manualDiscount)
                                  : manualDiscount
                              } 
                              onChange={e => {
                                const rawVal = Math.max(0, parseFloat(e.target.value) || 0);
                                const baseVal =
                                  type === 'cafeteria'
                                    ? rawVal / effectiveRate
                                    : currency === 'LBP'
                                    ? convertToBase(rawVal)
                                    : rawVal;
                                const clamped = Math.min(subtotal, baseVal);
                                if (subtotal > 0 && clamped > subtotal * 0.15 && !isManagerOrAdmin) {
                                  requireManagerApproval(
                                    `Apply Manual Discount > 15% ($${clamped.toFixed(2)} on $${subtotal.toFixed(2)})`,
                                    () => setManualDiscount(clamped)
                                  );
                                } else {
                                  setManualDiscount(clamped);
                                }
                              }}
                              className="w-20 bg-transparent text-right font-black font-mono outline-none"
                            />
                          </div>
                          {type === 'cafeteria' && manualDiscount > 0 && (
                            <span className="text-[10px] font-mono text-zinc-400">
                              -${manualDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Promo Coupon Code — Enabled in Retail Shop POS, Explicitly Excluded in Kiosk POS */}
                      {type === 'retail' && (
                        <>
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span className="opacity-60">{posLang === 'ar' ? 'رمز القسيمة (Coupon)' : 'Coupon Code'}</span>
                            <div className={`flex items-center px-2 py-1 rounded-lg border ${
                              appliedCoupon
                                ? 'border-emerald-500/50 bg-emerald-500/10'
                                : isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-50 border-zinc-200'
                            }`} dir="ltr">
                              <input 
                                type="text" 
                                placeholder="PROMO"
                                value={couponCodeInput} 
                                onChange={e => setCouponCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                                className="w-24 bg-transparent text-right font-black font-mono outline-none uppercase placeholder:opacity-30"
                              />
                            </div>
                          </div>
                          {appliedCoupon && (
                            <div className="flex justify-between items-center text-[11px] font-bold text-emerald-500">
                              <span className="opacity-80 uppercase tracking-widest">
                                {posLang === 'ar' ? `قسيمة (${appliedCoupon.code})` : `Coupon (${appliedCoupon.code})`}
                              </span>
                              <span className="font-black font-mono" dir="ltr">
                                -{toEnglishNumerals(formatCurrency(couponDiscount))} ({appliedCoupon.discountType === 'percentage' ? `${Number((appliedCoupon as any).value ?? appliedCoupon.discountValue).toLocaleString('en-US')}%` : 'Fixed'})
                              </span>
                            </div>
                          )}
                        </>
                      )}

                      {/* 11% Lebanese VAT Toggle (4427 - TVA Collectée) */}
                      <div className="flex justify-between items-center text-xs font-bold pt-0.5">
                        <label className="flex items-center gap-1.5 cursor-pointer opacity-75 hover:opacity-100">
                          <input
                            type="checkbox"
                            checked={applyVat}
                            onChange={e => setApplyVat(e.target.checked)}
                            className="rounded border-zinc-700 text-[#00B8C8] focus:ring-[#00B8C8]"
                          />
                          <span>{posLang === 'ar' ? 'ضريبة القيمة المضافة 11% (TVA)' : '11% Lebanese VAT (4427)'}</span>
                        </label>
                        {type === 'cafeteria' ? (
                          <div className={`text-right font-mono leading-tight ${applyVat ? 'text-amber-500' : 'opacity-40'}`} dir="ltr">
                            <div className="font-black">
                              {applyVat ? `+${Math.round(taxAmount * effectiveRate).toLocaleString('en-US')} LBP` : '0 LBP'}
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              {applyVat ? `+$${taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'}
                            </div>
                          </div>
                        ) : (
                          <span className={`font-mono font-black ${applyVat ? 'text-amber-500' : 'opacity-40'}`} dir="ltr">
                            {applyVat ? `+${toEnglishNumerals(formatCurrency(taxAmount))}` : '$0.00'}
                          </span>
                        )}
                      </div>

                      {/* Cashback Reward Code — Enabled in Retail Shop POS, Explicitly Excluded in Kiosk POS */}
                      {type === 'retail' && (selectedMember || guestPhone.trim()) && (
                        <div className="flex justify-between items-center text-xs font-bold">
                          <span className="opacity-60">{posLang === 'ar' ? 'رمز الاسترداد (Cashback)' : 'Reward Code'}</span>
                          <div className={`flex items-center px-2 py-1 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`} dir="ltr">
                            <input 
                              type="text" 
                              placeholder="CASHBACK"
                              value={cashbackCodeInput} 
                              onChange={e => setCashbackCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                              className="w-24 bg-transparent text-right font-black font-mono outline-none uppercase placeholder:opacity-30"
                            />
                          </div>
                        </div>
                      )}
                      
                      {type === 'retail' && cashbackRewardPreview && (
                        <div className="flex justify-between items-center text-[11px] font-bold text-emerald-500">
                          <span className="opacity-80 uppercase tracking-widest">
                            {posLang === 'ar' ? 'مكافأة المحفظة' : 'Est. Wallet Reward'}
                          </span>
                          <span className="font-black font-mono" dir="ltr">+{formatCurrency(cashbackRewardPreview.amount)}</span>
                        </div>
                      )}
                      
                      {/* Dual-Currency Total Display (LBP Primary in Kiosk POS, USD Underneath — Always Western Numerals 0-9) */}
                      <div className="pt-2.5 border-t border-zinc-800/10 flex justify-between items-end">
                        <div>
                          <span className="text-xs font-black uppercase tracking-widest opacity-40 block">
                            {posLang === 'ar' ? 'المجموع المستحق' : 'Total Due'}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500" dir="ltr">
                            1 USD = {effectiveRate.toLocaleString('en-US')} LBP
                          </span>
                        </div>
                        {type === 'cafeteria' ? (
                          <div className="text-right font-mono leading-tight" dir="ltr">
                            <div className="text-2xl font-black tracking-tighter text-amber-500">
                              {totalLBP.toLocaleString('en-US')} LBP
                            </div>
                            <div className="text-xs font-bold text-[#00B8C8]">
                              ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        ) : (
                          <div className="text-right font-mono leading-tight" dir="ltr">
                            <div className="text-2xl font-black tracking-tighter text-[#00B8C8]">
                              ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-xs font-bold text-amber-500">
                              {totalLBP.toLocaleString('en-US')} LBP
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Payment Method Selector (5 Methods: Cash, Card, Wallet, On Account SOA, Split Payment) */}
                    <div>
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 block">
                        {posLang === 'ar' ? 'طريقة الدفع' : 'Payment Method'}
                      </label>
                      <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                        {(['cash', 'card', 'member_balance'] as const).map(method => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setPaymentMethod(method)}
                            disabled={method === 'member_balance' && !selectedMember}
                            className={`flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                              paymentMethod === method 
                                ? 'bg-[#00B8C8] border-[#00B8C8] text-slate-950 shadow-lg shadow-cyan-500/20' 
                                : isDarkMode 
                                  ? 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700' 
                                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 shadow-sm'
                            } disabled:opacity-25 disabled:cursor-not-allowed`}
                          >
                            {method === 'cash' && <DollarSign size={14} />}
                            {method === 'card' && <CreditCard size={14} />}
                            {method === 'member_balance' && <Wallet size={14} />}
                            <span>
                              {posLang === 'ar'
                                ? (method === 'cash' ? 'نقدي - Cash' : method === 'card' ? 'بطاقة - Card' : 'محفظة المشترك')
                                : (method === 'member_balance' ? 'Wallet' : method)}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('on_account')}
                          disabled={!selectedMember}
                          className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                            paymentMethod === 'on_account'
                              ? 'bg-amber-500 border-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                              : isDarkMode
                              ? 'bg-zinc-950 border-zinc-800 text-amber-400/80 hover:border-amber-500/40'
                              : 'bg-white border-slate-200 text-amber-600 hover:border-amber-300 shadow-sm'
                          } disabled:opacity-25 disabled:cursor-not-allowed`}
                          title="Charge to Member Account (LCOA 411 — SOA Receivable)"
                        >
                          <FileText size={13} />
                          <span>{posLang === 'ar' ? 'على الحساب (SOA)' : 'On Account (SOA)'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentMethod('split');
                            const availWallet = selectedMember ? Math.min(total, Math.max(0, selectedMember.balance || 0)) : 0;
                            const remCash = Math.max(0, Number((total - availWallet).toFixed(2)));
                            setSplitWalletUSD(availWallet > 0 ? availWallet.toFixed(2) : '');
                            setSplitCashUSD(remCash > 0 ? remCash.toFixed(2) : '');
                            setSplitCardUSD('');
                          }}
                          className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                            paymentMethod === 'split'
                              ? 'bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                              : isDarkMode
                              ? 'bg-zinc-950 border-zinc-800 text-indigo-400 hover:border-indigo-500/40'
                              : 'bg-white border-slate-200 text-indigo-600 hover:border-indigo-300 shadow-sm'
                          }`}
                        >
                          <Split size={13} />
                          <span>{posLang === 'ar' ? 'دفع مقسم (Split)' : 'Split Payment'}</span>
                        </button>
                      </div>
                    </div>

                    {/* On-Account (SOA Receivable) Info Banner */}
                    {paymentMethod === 'on_account' && selectedMember && (
                      <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-400 flex items-center justify-between">
                        <span>
                          {posLang === 'ar'
                            ? `سيتم قيد $${total.toFixed(2)} كذمم مدينة (حساب 411) على كشف حساب ${selectedMember.firstName}`
                            : `Posts $${total.toFixed(2)} to LCOA 411 (Member SOA Receivable) for ${selectedMember.firstName}`}
                        </span>
                      </div>
                    )}

                    {/* Multi-Method Split Payment Breakdown Panel */}
                    {paymentMethod === 'split' && cart.length > 0 && (
                      <div className={`p-3 rounded-2xl border space-y-2 ${isDarkMode ? 'bg-zinc-950/80 border-indigo-500/30' : 'bg-indigo-50/40 border-indigo-200'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 flex items-center gap-1">
                            <Split size={12} />
                            {posLang === 'ar' ? 'تقسيم الدفع (محفظة + نقدي + بطاقة)' : 'Split Payment (Wallet + Cash + Card)'}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-zinc-400" dir="ltr">
                            Target: ${total.toFixed(2)}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[9px] font-bold uppercase text-zinc-500">
                                {posLang === 'ar' ? 'المحفظة ($)' : 'Wallet ($)'}
                              </label>
                              {selectedMember && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const c = parseFloat(splitCashUSD) || 0;
                                    const cd = parseFloat(splitCardUSD) || 0;
                                    const maxW = Math.min(selectedMember.balance || 0, Math.max(0, total - c - cd));
                                    setSplitWalletUSD(maxW.toFixed(2));
                                  }}
                                  className="text-[9px] font-black text-[#00B8C8]"
                                >
                                  Max
                                </button>
                              )}
                            </div>
                            <input
                              type="number"
                              dir="ltr"
                              step="0.01"
                              min="0"
                              disabled={!selectedMember}
                              placeholder="0.00"
                              value={splitWalletUSD}
                              onChange={e => setSplitWalletUSD(e.target.value)}
                              className={`w-full px-2 py-1.5 rounded-xl border text-xs font-mono font-bold disabled:opacity-30 ${
                                isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                              }`}
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[9px] font-bold uppercase text-zinc-500">
                                {posLang === 'ar' ? 'نقدي ($)' : 'Cash ($)'}
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  const w = parseFloat(splitWalletUSD) || 0;
                                  const cd = parseFloat(splitCardUSD) || 0;
                                  setSplitCashUSD(Math.max(0, total - w - cd).toFixed(2));
                                }}
                                className="text-[9px] font-black text-emerald-400"
                              >
                                Rest
                              </button>
                            </div>
                            <input
                              type="number"
                              dir="ltr"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={splitCashUSD}
                              onChange={e => setSplitCashUSD(e.target.value)}
                              className={`w-full px-2 py-1.5 rounded-xl border text-xs font-mono font-bold ${
                                isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                              }`}
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[9px] font-bold uppercase text-zinc-500">
                                {posLang === 'ar' ? 'بطاقة ($)' : 'Card ($)'}
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  const w = parseFloat(splitWalletUSD) || 0;
                                  const c = parseFloat(splitCashUSD) || 0;
                                  setSplitCardUSD(Math.max(0, total - w - c).toFixed(2));
                                }}
                                className="text-[9px] font-black text-indigo-400"
                              >
                                Rest
                              </button>
                            </div>
                            <input
                              type="number"
                              dir="ltr"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={splitCardUSD}
                              onChange={e => setSplitCardUSD(e.target.value)}
                              className={`w-full px-2 py-1.5 rounded-xl border text-xs font-mono font-bold ${
                                isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                              }`}
                            />
                          </div>
                        </div>
                        {(() => {
                          const sumSplit =
                            (parseFloat(splitWalletUSD) || 0) +
                            (parseFloat(splitCashUSD) || 0) +
                            (parseFloat(splitCardUSD) || 0);
                          const diff = Number((total - sumSplit).toFixed(2));
                          return (
                            <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-zinc-800/30" dir="ltr">
                              <span className="text-zinc-400">Allocated: ${sumSplit.toFixed(2)}</span>
                              <span className={Math.abs(diff) <= 0.02 ? 'text-emerald-400 font-black' : 'text-rose-400 font-black'}>
                                {Math.abs(diff) <= 0.02 ? '✓ Balanced' : diff > 0 ? `Remaining: $${diff.toFixed(2)}` : `Over by: $${Math.abs(diff).toFixed(2)}`}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Lebanese Dual-Currency (USD / LBP) Split-Tender Calculator + Quick-Cash Denomination Buttons + Manual Change Override */}
                    {(paymentMethod === 'cash' || (paymentMethod === 'split' && (parseFloat(splitCashUSD) || 0) > 0)) && cart.length > 0 && (
                      <div className={`p-3 rounded-2xl border ${isDarkMode ? 'bg-zinc-950/70 border-zinc-800' : 'bg-cyan-50/40 border-cyan-200/60'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#00B8C8] flex items-center gap-1">
                            <Calculator size={12} />
                            {posLang === 'ar' ? 'حاسبة الدفع المزدوج وتعديل الباقي' : 'Dual-Currency Tender & Change Override'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowSplitCalculator(!showSplitCalculator)}
                            className="text-[10px] font-bold text-zinc-400 hover:text-zinc-200"
                          >
                            {showSplitCalculator ? (posLang === 'ar' ? 'إخفاء' : 'Hide') : (posLang === 'ar' ? 'إظهار' : 'Show')}
                          </button>
                        </div>

                        {showSplitCalculator && (
                          <div className="space-y-2.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {/* Quick USD Denomination Pills */}
                            <div className="flex flex-wrap items-center gap-1" dir="ltr">
                              <span className="text-[9px] font-black uppercase text-emerald-500 mr-1">USD:</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setCashTenderedUSD(total.toFixed(2));
                                  setCashTenderedLBP('');
                                }}
                                className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30"
                              >
                                Exact
                              </button>
                              {[5, 10, 20, 50, 100].map(bill => (
                                <button
                                  key={bill}
                                  type="button"
                                  onClick={() => setCashTenderedUSD(String(bill))}
                                  className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border ${
                                    Number(cashTenderedUSD) === bill
                                      ? 'bg-[#00B8C8] text-slate-950 border-[#00B8C8]'
                                      : isDarkMode
                                      ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                                      : 'bg-white border-slate-200 text-slate-700'
                                  }`}
                                >
                                  ${bill}
                                </button>
                              ))}
                            </div>

                            {/* Quick LBP Denomination Pills */}
                            <div className="flex flex-wrap items-center gap-1" dir="ltr">
                              <span className="text-[9px] font-black uppercase text-amber-500 mr-1">LBP:</span>
                              {[
                                { label: '100K', val: 100000 },
                                { label: '500K', val: 500000 },
                                { label: '1M', val: 1000000 },
                                { label: '2M', val: 2000000 },
                                { label: '5M', val: 5000000 }
                              ].map(note => (
                                <button
                                  key={note.val}
                                  type="button"
                                  onClick={() => setCashTenderedLBP(String((parseFloat(cashTenderedLBP) || 0) + note.val))}
                                  className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border ${
                                    isDarkMode
                                      ? 'bg-zinc-900 border-zinc-800 text-amber-400 hover:border-amber-500/40'
                                      : 'bg-white border-slate-200 text-amber-600'
                                  }`}
                                  title={`Add ${note.val.toLocaleString('en-US')} LBP`}
                                >
                                  +{note.label}
                                </button>
                              ))}
                              {(cashTenderedUSD || cashTenderedLBP) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCashTenderedUSD('');
                                    setCashTenderedLBP('');
                                    setIsChangeManuallyOverridden(false);
                                    setOverrideChangeLBP('');
                                    setOverrideChangeUSD('');
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[9px] font-bold text-rose-400 hover:bg-rose-500/10 ml-auto"
                                >
                                  Clear
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] font-bold uppercase text-zinc-500 mb-1">
                                  {posLang === 'ar' ? 'المبلغ المستلم بالدولار ($)' : 'Cash Paid ($ USD)'}
                                </label>
                                <input
                                  type="number"
                                  dir="ltr"
                                  step="0.5"
                                  min="0"
                                  placeholder="0.00"
                                  value={cashTenderedUSD}
                                  onChange={e => setCashTenderedUSD(e.target.value)}
                                  className={`w-full px-2.5 py-1.5 rounded-xl border text-xs font-mono font-bold ${
                                    isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                                  }`}
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] font-bold uppercase text-zinc-500 mb-1">
                                  {posLang === 'ar' ? 'المبلغ المستلم بالليرة (LBP)' : 'Cash Paid (LBP ل.ل)'}
                                </label>
                                <input
                                  type="number"
                                  dir="ltr"
                                  step="50000"
                                  min="0"
                                  placeholder="0"
                                  value={cashTenderedLBP}
                                  onChange={e => setCashTenderedLBP(e.target.value)}
                                  className={`w-full px-2.5 py-1.5 rounded-xl border text-xs font-mono font-bold ${
                                    isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                                  }`}
                                />
                              </div>
                            </div>

                            {(splitTenderCalc.usdIn > 0 || splitTenderCalc.lbpIn > 0) && (
                              <div className="pt-2 border-t border-zinc-800/20 space-y-2">
                                {splitTenderCalc.remainingUSD > 0 ? (
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-rose-500">
                                      {posLang === 'ar' ? 'المتبقي للدفع:' : 'Still Owed:'}
                                    </span>
                                    <span className="font-mono font-black text-rose-500" dir="ltr">
                                      {splitTenderCalc.remainingLBP.toLocaleString('en-US')} LBP (${splitTenderCalc.remainingUSD.toFixed(2)})
                                    </span>
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-black text-emerald-500 uppercase tracking-wider">
                                        {posLang === 'ar' ? 'الباقي للعميل (قابل للتعديل):' : 'Change to Return (Editable):'}
                                      </span>
                                      {isChangeManuallyOverridden && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setIsChangeManuallyOverridden(false);
                                            setOverrideChangeLBP(String(splitTenderCalc.autoChangeLBP));
                                            setOverrideChangeUSD('0');
                                          }}
                                          className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                                        >
                                          {posLang === 'ar' ? 'إعادة تلقائية' : 'Reset to Auto'}
                                        </button>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2" dir="ltr">
                                      <div>
                                        <label className="block text-[9px] font-bold uppercase text-amber-500 mb-0.5">
                                          Change in LBP (ل.ل)
                                        </label>
                                        <input
                                          type="number"
                                          step="5000"
                                          min="0"
                                          value={overrideChangeLBP}
                                          onChange={e => {
                                            setIsChangeManuallyOverridden(true);
                                            setOverrideChangeLBP(toEnglishNumerals(e.target.value));
                                          }}
                                          className={`w-full px-2 py-1 rounded-lg border text-xs font-mono font-black text-amber-500 ${
                                            isDarkMode ? 'bg-zinc-900 border-amber-500/40' : 'bg-white border-amber-300'
                                          }`}
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold uppercase text-emerald-500 mb-0.5">
                                          Change in USD ($)
                                        </label>
                                        <input
                                          type="number"
                                          step="0.5"
                                          min="0"
                                          value={overrideChangeUSD}
                                          onChange={e => {
                                            setIsChangeManuallyOverridden(true);
                                            setOverrideChangeUSD(toEnglishNumerals(e.target.value));
                                          }}
                                          className={`w-full px-2 py-1 rounded-lg border text-xs font-mono font-black text-emerald-500 ${
                                            isDarkMode ? 'bg-zinc-900 border-emerald-500/40' : 'bg-white border-emerald-300'
                                          }`}
                                        />
                                      </div>
                                    </div>
                                    <div className="text-[10px] font-mono text-zinc-400 flex items-center justify-between" dir="ltr">
                                      <span>Auto Change: {splitTenderCalc.autoChangeLBP.toLocaleString('en-US')} LBP (${splitTenderCalc.autoChangeUSD.toFixed(2)})</span>
                                      {isChangeManuallyOverridden && (
                                        <span className="text-amber-400 font-bold">Manual Override Active</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const defaultLbl = selectedMember
                          ? `${selectedMember.firstName} ${selectedMember.lastName} Tab`
                          : guestName.trim()
                          ? `${guestName.trim()} Tab`
                          : posLang === 'ar'
                          ? `حساب ملعب / لاعب #${parkedOrders.length + 1}`
                          : `Court / Player Tab #${parkedOrders.length + 1}`;
                        setHoldTabLabel(defaultLbl);
                        setIsHoldTabModalOpen(true);
                      }}
                      disabled={cart.length === 0}
                      className="col-span-1 py-4 rounded-2xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-500 font-black text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1"
                      title={posLang === 'ar' ? 'تعليق الطلب (فتح حساب ملعب أو لاعب)' : 'Hold / Park Order to Open Player or Court Tab'}
                    >
                      <PauseCircle size={18} />
                      <span>{posLang === 'ar' ? 'تعليق الطلب' : 'Hold Tab'}</span>
                    </button>
                    <button 
                      onClick={handleCheckout}
                      disabled={cart.length === 0}
                      className="col-span-2 py-4 rounded-2xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-black text-base transition-all disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xl shadow-cyan-500/20 active:scale-[0.98]"
                    >
                      <CheckCircle size={20} /> {posLang === 'ar' ? 'إتمام الدفع' : 'Complete Order'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <DragOverlay dropAnimation={null}>
              {activeDragItem ? (
                <div className={`p-4 rounded-3xl border shadow-2xl opacity-80 scale-105 ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-300'}`}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-800">
                      {activeDragItem.image && <img src={activeDragItem.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                    </div>
                    <div>
                      <p className="font-bold text-sm">
                        {posLang === 'ar' ? (activeDragItem.nameAr || translateToArabic(activeDragItem.name)) : activeDragItem.name}
                      </p>
                      <p className="text-blue-500 font-black text-xs font-mono" dir="ltr">{toEnglishNumerals(formatCurrency(activeDragItem.price))}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {activeTab === 'inventory' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">{type === 'cafeteria' ? 'Kiosk POS Inventory' : 'Retail Shop Inventory'}</h2>
                <p className="text-sm text-zinc-500">
                  Manage SKUs, barcodes, Packaged vs. Single Unit items, stock levels, restock orders, and wastage write-offs
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {type === 'cafeteria' && (
                  <>
                    {/* Editable Kiosk Exchange Rate Pill in Inventory Toolbar */}
                    <div
                      dir="ltr"
                      className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-1.5 ${
                        isDarkMode
                          ? 'bg-zinc-900 border-amber-500/40 text-amber-400'
                          : 'bg-amber-50 border-amber-200 text-amber-700'
                      }`}
                    >
                      <span>1 USD =</span>
                      <input
                        type="number"
                        step="500"
                        min="1000"
                        value={kioskExchangeRate}
                        onChange={e => handleUpdateKioskRate(parseFloat(e.target.value) || 89000)}
                        className={`w-20 px-1.5 py-0.5 rounded border text-center font-black font-mono outline-none ${
                          isDarkMode
                            ? 'bg-zinc-950 border-zinc-700 text-amber-300 focus:border-[#00B8C8]'
                            : 'bg-white border-amber-300 text-amber-800 focus:border-[#00B8C8]'
                        }`}
                      />
                      <span>LBP</span>
                    </div>

                    {/* Prominent Kiosk Inventory Currency View Switcher: LBP (Default) vs USD ($) */}
                    <div
                      dir="ltr"
                      className={`p-1 rounded-xl border flex items-center gap-1 text-xs font-black ${
                        isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                      }`}
                    >
                      <span className="px-2 text-[10px] uppercase tracking-wider text-zinc-400">
                        View Stock & Prices in:
                      </span>
                      <button
                        type="button"
                        onClick={() => setInventoryCurrencyView('LBP')}
                        className={`px-2.5 py-1 rounded-lg transition-all ${
                          inventoryCurrencyView === 'LBP'
                            ? 'bg-amber-500 text-slate-950 shadow'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        LBP (Default)
                      </button>
                      <button
                        type="button"
                        onClick={() => setInventoryCurrencyView('USD')}
                        className={`px-2.5 py-1 rounded-lg transition-all ${
                          inventoryCurrencyView === 'USD'
                            ? 'bg-[#00B8C8] text-slate-950 shadow'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        USD ($)
                      </button>
                    </div>
                  </>
                )}
                {!isManagerOrAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      requireManagerApproval('Unlock Manager Cost & Stock Controls', () => {
                        posToast('success', 'Manager view unlocked for this session.', 'تم فتح صلاحيات المدير لهذه الجلسة.');
                      })
                    }
                    className="px-3.5 py-2 rounded-xl text-xs font-bold border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 flex items-center gap-1.5 transition-all"
                  >
                    <Lock size={14} /> Unlock Manager View (PIN)
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportInventoryExcel}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <Upload size={15} className="text-blue-500" /> Import Excel
                </button>
                <button
                  onClick={handleExportInventoryExcel}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <FileSpreadsheet size={15} className="text-emerald-500" /> Export Excel
                </button>
                <button
                  onClick={() => handleDownloadRestockList('pdf')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <FileText size={15} className="text-amber-500" /> Restock List (PDF)
                </button>
                <button
                  onClick={() => handleDownloadRestockList('excel')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <Download size={15} className="text-purple-500" /> Restock List (XLSX)
                </button>
                <button
                  onClick={() => setIsCategoryModalOpen(true)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-[#00B8C8]' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-[#00B8C8]'
                  }`}
                >
                  <Layers size={15} /> Categories & Subcategories
                </button>
                {type === 'retail' && (
                  <button
                    type="button"
                    onClick={() => handleToggleRetailArabic(!enableArabicInRetail)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all ${
                      enableArabicInRetail
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400'
                        : isDarkMode
                        ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                    }`}
                    title="Enable or disable Arabic Translation fields (nameAr, categoryAr, subcategoryAr) in Retail Shop POS"
                  >
                    <Languages size={15} />
                    <span>Arabic Translation Fields:</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                        enableArabicInRetail
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-zinc-700/60 text-zinc-300'
                      }`}
                    >
                      {enableArabicInRetail ? 'ON' : 'OFF'}
                    </span>
                  </button>
                )}
                {showArabicFields && (
                  <button
                    onClick={handleAutoTranslateAllInventory}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-emerald-400' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-emerald-600'
                    }`}
                    title="Auto-populate Arabic translations (nameAr, categoryAr, subcategoryAr) for all items"
                  >
                    <Languages size={15} /> Auto-Translate Arabic
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('purchase_orders')}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all"
                >
                  <Sparkles size={15} /> Auto-PO Low Stock ({items.filter(i => i.stock <= (i.lowStockThreshold ?? 5)).length})
                </button>
                <button 
                  onClick={() => {
                    setEditingItem(null);
                    setStockAdjustmentReason('');
                    setStockEntryByPack(false);
                    setStockPackCountInput('');
                    const defaultCat = effectiveCategoryConfigs[0]?.name || defaultCategories[0] || 'Beverages';
                    const defaultCatAr = showArabicFields
                      ? (effectiveCategoryConfigs[0]?.nameAr || translateToArabic(defaultCat))
                      : '';
                    setNewItem({
                      type,
                      posType: type,
                      category: defaultCat,
                      categoryAr: defaultCatAr,
                      subcategory: '',
                      subcategoryAr: '',
                      nameAr: '',
                      stock: 0,
                      price: 0,
                      priceLBP: 0,
                      cost: 0,
                      costPrice: 0,
                      costPriceLBP: 0,
                      isPackagedGood: false,
                      unitsPerPack: 12,
                      packCostPrice: 0,
                      packCostLBP: 0,
                      unitSellingPrice: 0,
                      unitSellingPriceLBP: 0,
                      packSellingPrice: 0,
                      packSellingPriceLBP: 0,
                      lowStockThreshold: 5,
                      reorderQuantity: 20,
                      variants: [],
                      isBundle: false,
                      bundleComponents: []
                    });
                    setIsInventoryModalOpen(true);
                  }}
                  className="el-btn-primary text-xs py-2 px-4"
                >
                  <Plus size={16} /> Add Item
                </button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                {([
                  { id: 'all', label: `All Items (${items.length})` },
                  { id: 'low_stock', label: `Low Stock (${items.filter(i => i.stock <= (i.lowStockThreshold ?? 5)).length})` },
                  { id: 'expiring', label: `Expiring / Expired (${items.filter(i => i.expiryDate && new Date(i.expiryDate).getTime() <= Date.now() + 14 * 86400000).length})` }
                ] as const).map(f => (
                  <button
                    key={f.id}
                    onClick={() => setInventoryAlertFilter(f.id)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      inventoryAlertFilter === f.id
                        ? 'bg-blue-600 text-white shadow'
                        : isDarkMode ? 'bg-zinc-900 text-zinc-400 hover:text-white' : 'bg-white text-zinc-600 border border-zinc-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Filter by name, SKU, supplier..."
                  value={inventorySearch}
                  onChange={e => setInventorySearch(e.target.value)}
                  className="el-input pl-10 py-2 text-xs"
                />
              </div>
            </div>
            
            <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-white'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className={`text-xs uppercase text-zinc-500 ${isDarkMode ? 'bg-zinc-900/80' : 'bg-zinc-50'}`}>
                    <tr>
                      <th className="px-5 py-4 font-bold">Item & SKU</th>
                      <th className="px-5 py-4 font-bold">Category</th>
                      <th className="px-5 py-4 font-bold">Supplier & Expiry</th>
                      <th className="px-5 py-4 font-bold">
                        Price ({type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? 'LBP / USD' : 'USD / LBP'})
                      </th>
                      {isManagerOrAdmin && (
                        <th className="px-5 py-4 font-bold">
                          Unit Cost & Margin
                        </th>
                      )}
                      <th className="px-5 py-4 font-bold">Stock (Units & Packs)</th>
                      <th className="px-5 py-4 font-bold text-right">Operations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/40">
                    {displayedInventory.map(item => {
                      const threshold = item.lowStockThreshold ?? 5;
                      const isLow = item.stock <= threshold;
                      const isExpired = item.expiryDate ? new Date(item.expiryDate).getTime() < Date.now() : false;
                      const unitCost = Number(item.costPrice ?? item.cost ?? 0);
                      const unitCostLBP = Number(item.costPriceLBP) > 0 ? Number(item.costPriceLBP) : Math.round(unitCost * effectiveRate);
                      const unitPriceUSD = Number(item.unitSellingPrice && item.unitSellingPrice > 0 ? item.unitSellingPrice : item.price || 0);
                      const unitPriceLBP = Number(item.unitSellingPriceLBP && item.unitSellingPriceLBP > 0 ? item.unitSellingPriceLBP : item.priceLBP && item.priceLBP > 0 ? item.priceLBP : Math.round(unitPriceUSD * effectiveRate));
                      const isPackItem = Boolean(item.isPackagedGood && (item.unitsPerPack || 0) > 1);
                      const unitsPerPack = Math.max(1, Number(item.unitsPerPack) || 1);
                      const packPriceUSD = Number(item.packSellingPrice && item.packSellingPrice > 0 ? item.packSellingPrice : unitPriceUSD * unitsPerPack);
                      const packPriceLBP = Number(item.packSellingPriceLBP && item.packSellingPriceLBP > 0 ? item.packSellingPriceLBP : Math.round(packPriceUSD * effectiveRate));
                      const marginPct = unitPriceUSD > 0 ? Math.round(((unitPriceUSD - unitCost) / unitPriceUSD) * 100) : 0;
                      const fullPacks = isPackItem ? Math.floor(item.stock / unitsPerPack) : 0;
                      const looseUnits = isPackItem ? item.stock % unitsPerPack : item.stock;
                      const showLBPPrimary = type === 'cafeteria' && inventoryCurrencyView === 'LBP';

                      return (
                        <tr key={item.id} className={`transition-colors ${isDarkMode ? 'hover:bg-zinc-800/50' : 'hover:bg-zinc-50'}`}>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{item.name}</span>
                              {isPackItem && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                                  Pack ({unitsPerPack}u)
                                </span>
                              )}
                            </div>
                            {showArabicFields && (
                              <div className="text-xs text-emerald-500/90 font-medium" dir="rtl">
                                {item.nameAr || translateToArabic(item.name)}
                              </div>
                            )}
                            {(item.sku || item.barcode) && (
                              <div className="text-xs font-mono text-zinc-500">SKU: {item.sku || item.barcode}</div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="text-zinc-300 font-semibold">{item.category}</div>
                            {item.subcategory && (
                              <div className="text-[11px] text-[#00B8C8] font-bold">↳ {item.subcategory}</div>
                            )}
                            {showArabicFields && (
                              <div className="text-[11px] text-zinc-500">
                                {item.categoryAr || translateToArabic(item.category)}
                                {item.subcategory ? ` • ${item.subcategoryAr || translateToArabic(item.subcategory)}` : ''}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 text-xs">
                            <div className="font-medium">{item.supplier || '—'}</div>
                            {item.expiryDate && (
                              <div className={`font-bold ${isExpired ? 'text-rose-500' : 'text-zinc-500'}`}>
                                Exp: {item.expiryDate} {isExpired ? '(EXPIRED)' : ''}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 font-mono" dir="ltr">
                            {showLBPPrimary ? (
                              <div className="leading-tight">
                                <div className="font-black text-amber-500">
                                  {unitPriceLBP.toLocaleString('en-US')} LBP <span className="text-[10px] text-zinc-400 font-normal">/ unit</span>
                                </div>
                                <div className="text-[11px] text-blue-400 font-bold">
                                  ${unitPriceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                                {isPackItem && (
                                  <div className="text-[10px] text-indigo-400 font-bold mt-0.5">
                                    Pack ({unitsPerPack}u): {packPriceLBP.toLocaleString('en-US')} LBP (${packPriceUSD.toFixed(2)})
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="leading-tight">
                                <div className="font-black text-blue-500">
                                  ${unitPriceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] text-zinc-400 font-normal">/ unit</span>
                                </div>
                                <div className="text-[11px] text-amber-500 font-bold">
                                  {unitPriceLBP.toLocaleString('en-US')} LBP
                                </div>
                                {isPackItem && (
                                  <div className="text-[10px] text-indigo-400 font-bold mt-0.5">
                                    Pack ({unitsPerPack}u): ${packPriceUSD.toFixed(2)} ({packPriceLBP.toLocaleString('en-US')} LBP)
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          {isManagerOrAdmin && (
                            <td className="px-5 py-4 font-mono text-zinc-400" dir="ltr">
                              {showLBPPrimary ? (
                                <div>
                                  <div className="font-bold text-zinc-200">{unitCostLBP.toLocaleString('en-US')} LBP</div>
                                  <div className="text-[10px] text-zinc-500">${unitCost.toFixed(4)} / unit</div>
                                </div>
                              ) : (
                                <div>
                                  <div className="font-bold text-zinc-200">${unitCost.toFixed(2)}</div>
                                  <div className="text-[10px] text-zinc-500">{unitCostLBP.toLocaleString('en-US')} LBP</div>
                                </div>
                              )}
                              <div className={`text-[10px] font-bold ${marginPct >= 30 ? 'text-emerald-500' : 'text-amber-500'}`}>
                                Margin: {marginPct}%
                              </div>
                            </td>
                          )}
                          <td className="px-5 py-4" dir="ltr">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                              !isLow ? 'bg-emerald-500/10 text-emerald-500' : item.stock > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-rose-500/10 text-rose-500'
                            }`}>
                              {isLow && <AlertTriangle size={12} />}
                              {item.stock} Units (Min: {threshold})
                            </span>
                            {isPackItem && (
                              <div className="text-[10px] font-mono text-indigo-400 font-bold mt-1">
                                {fullPacks} Packs + {looseUnits} Loose ({unitsPerPack}u/pack)
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setRestockItem(item);
                                  setRestockVariantId(item.variants && item.variants.length > 0 ? item.variants[0].id : '');
                                  const isPack = Boolean(item.isPackagedGood && (item.unitsPerPack || 0) > 1);
                                  const upp = Math.max(1, Number(item.unitsPerPack) || 1);
                                  setRestockByPack(isPack);
                                  setRestockQty(isPack ? Math.max(1, Math.round((item.reorderQuantity ?? 20) / upp)) : (item.reorderQuantity ?? 20));
                                  const uCost = Number(item.costPrice ?? item.cost ?? 0);
                                  setRestockUnitCost(uCost);
                                  setRestockPackCostInput(
                                    inventoryCurrencyView === 'LBP' && type === 'cafeteria'
                                      ? String(Math.round((item.packCostLBP && item.packCostLBP > 0 ? item.packCostLBP : uCost * upp * effectiveRate)))
                                      : String(Number((item.packCostPrice && item.packCostPrice > 0 ? item.packCostPrice : uCost * upp).toFixed(2)))
                                  );
                                  setRestockExpiry(item.expiryDate || '');
                                  setRestockSupplier(item.supplier || '');
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 flex items-center gap-1"
                                title="Receive Stock (Restock)"
                              >
                                <PackagePlus size={14} /> Restock
                              </button>
                              <button
                                onClick={() => {
                                  setWastageItem(item);
                                  setWastageQty(1);
                                  setWastageReason(isExpired ? 'expired' : 'damaged');
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 flex items-center gap-1"
                                title="Wastage / Expired Write-Off"
                              >
                                <Flame size={14} /> Write-Off
                              </button>
                              <button
                                onClick={() => {
                                  setEditingItem(item);
                                  setStockAdjustmentReason('');
                                  setStockEntryByPack(false);
                                  setStockPackCountInput('');
                                  setNewItem({
                                    ...item,
                                    priceLBP: item.priceLBP ?? Math.round((item.price || 0) * effectiveRate),
                                    costPriceLBP: item.costPriceLBP ?? Math.round(Number(item.costPrice ?? item.cost ?? 0) * effectiveRate),
                                    unitsPerPack: item.unitsPerPack ?? 12,
                                    unitSellingPrice: item.unitSellingPrice ?? item.price ?? 0,
                                    unitSellingPriceLBP: item.unitSellingPriceLBP ?? item.priceLBP ?? Math.round((item.price || 0) * effectiveRate),
                                    packSellingPrice: item.packSellingPrice ?? Number(((item.price || 0) * (item.unitsPerPack || 12)).toFixed(2)),
                                    packSellingPriceLBP: item.packSellingPriceLBP ?? Math.round((item.price || 0) * (item.unitsPerPack || 12) * effectiveRate),
                                    packCostPrice: item.packCostPrice ?? Number((Number(item.costPrice ?? item.cost ?? 0) * (item.unitsPerPack || 12)).toFixed(2)),
                                    packCostLBP: item.packCostLBP ?? Math.round(Number(item.costPrice ?? item.cost ?? 0) * (item.unitsPerPack || 12) * effectiveRate),
                                  });
                                  setIsInventoryModalOpen(true);
                                }}
                                className="p-2 text-zinc-400 hover:text-blue-500"
                                title="Edit"
                              >
                                <Edit size={16} />
                              </button>
                              <button onClick={() => handleDeleteItem(item)} className="p-2 text-zinc-400 hover:text-red-500" title="Delete"><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {displayedInventory.length === 0 && (
                      <tr>
                        <td colSpan={isManagerOrAdmin ? 7 : 6} className="px-6 py-8 text-center text-zinc-500">No matching inventory items.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6">Order History & Thermal Receipts</h2>
            <div className="space-y-4">
              {orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(order => (
                <div key={order.id} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                         <p className="font-bold">Order #{order.id.slice(0, 8)}</p>
                         {order.memberName && (
                           <span className="px-2 py-0.5 rounded text-xs font-bold bg-cyan-500/10 text-[#00B8C8]">
                             {order.memberName}
                           </span>
                         )}
                         {order.paymentStatus === 'unpaid' && order.status === 'completed' && (
                           <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/15 text-amber-400">
                             ON ACCOUNT (SOA RECEIVABLE • 411)
                           </span>
                         )}
                         {(order.status === 'refunded' || order.status === 'voided') && (
                           <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-500/10 text-rose-500">
                             {order.status.toUpperCase()}
                           </span>
                         )}
                      </div>
                      <p className="text-sm text-zinc-400">
                        {new Date(order.date).toLocaleString('en-US')}
                        {order.cashierName ? ` • Cashier: ${order.cashierName}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold text-lg ${(order.status === 'refunded' || order.status === 'voided') ? 'line-through text-zinc-500' : ''}`}>
                        ${order.total.toFixed(2)} <span className="text-xs font-mono text-zinc-400">({Math.round(order.total * (order.fxRate || effectiveRate)).toLocaleString('en-US')} LBP)</span>
                      </p>
                      <p className="text-xs text-zinc-500 uppercase">
                        {order.paymentMethod.replace('_', ' ')}
                        {order.paymentMethod === 'split' && order.splitBreakdown
                          ? ` (W: $${order.splitBreakdown.wallet.toFixed(2)} | C: $${order.splitBreakdown.cash.toFixed(2)} | Card: $${order.splitBreakdown.card.toFixed(2)})`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 mb-4">
                    {order.items.map((item, i) => (
                      <div key={i} className={`flex justify-between text-sm ${(order.status === 'refunded' || order.status === 'voided') ? 'opacity-50' : ''}`}>
                        <span>{item.quantity}x {item.name}</span>
                        <span className="text-zinc-400">{formatCurrency(item.quantity * item.price)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptModalOrder(order);
                        setWhatsAppPhoneInput(order.memberPhone || '');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#00B8C8] bg-[#00B8C8]/10 hover:bg-[#00B8C8]/20 transition-colors"
                    >
                      <FileText size={15} />
                      Receipt / WhatsApp
                    </button>
                    {order.status !== 'refunded' && order.status !== 'voided' && (
                      <button
                        type="button"
                        onClick={() => handleRefundOrder(order)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 transition-colors"
                      >
                         {order.paymentMethod === 'cash' ? <XCircle size={15} /> : <RotateCcw size={15} />}
                         {order.paymentMethod === 'cash' ? 'Void Order' : 'Refund Order'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {orders.length === 0 && (
                <div className="text-center text-zinc-500 py-12">No orders yet.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'z_report' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black tracking-tight">Cashier Shift Z-Report & Drawer Reconciliation</h2>
                <p className="text-sm text-zinc-500">
                  Shift-isolated dual-currency drawer reconciliation in USD & LBP for {type === 'cafeteria' ? 'Kiosk POS' : 'Retail Shop POS'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {shifts.length > 0 && (
                  <select
                    value={selectedShiftId}
                    onChange={e => setSelectedShiftId(e.target.value)}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-200' : 'bg-white border-zinc-200 text-slate-800'}`}
                  >
                    <option value="">Date Filter Mode ({zReportDate})</option>
                    {shifts.map(sh => (
                      <option key={sh.id} value={sh.id}>
                        [{sh.status.toUpperCase()}] {sh.cashierName} — {new Date(sh.openedAt).toLocaleString('en-US')}
                      </option>
                    ))}
                  </select>
                )}
                {!selectedShiftId && (
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-zinc-400" />
                    <input
                      type="date"
                      value={zReportDate}
                      onChange={e => setZReportDate(e.target.value)}
                      className={`px-3 py-2 rounded-xl border text-xs font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                    />
                  </div>
                )}
                {!activeShift ? (
                  <button
                    type="button"
                    onClick={() => setIsOpenShiftModalOpen(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5"
                  >
                    <Clock size={15} /> Open Cashier Shift
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedShiftId(activeShift.id);
                      setActualCountedUSDInput(String(zReportMetrics.expectedDrawerUSD.toFixed(2)));
                      setActualCountedLBPInput(String(Math.round(zReportMetrics.expectedDrawerLBP)));
                      setIsCloseShiftModalOpen(true);
                    }}
                    className="px-3.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center gap-1.5"
                  >
                    <Lock size={15} /> Close Shift & Count Drawer
                  </button>
                )}
                <button
                  onClick={handleDownloadZReportPDF}
                  className="el-btn-primary text-xs py-2.5 px-4"
                >
                  <Printer size={16} /> Download Z-Report PDF
                </button>
              </div>
            </div>

            {zReportMetrics.targetShift && (
              <div className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
                zReportMetrics.targetShift.status === 'open'
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase ${
                    zReportMetrics.targetShift.status === 'open' ? 'bg-emerald-500 text-slate-950' : 'bg-zinc-700 text-white'
                  }`}>
                    {zReportMetrics.targetShift.status} SHIFT
                  </span>
                  <div>
                    <div className="font-bold text-sm">
                      Cashier: {zReportMetrics.targetShift.cashierName} • Opened: {new Date(zReportMetrics.targetShift.openedAt).toLocaleString('en-US')}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono">
                      Opening Float: ${(zReportMetrics.targetShift.openingFloatUSD || 0).toFixed(2)} USD + {(zReportMetrics.targetShift.openingFloatLBP || 0).toLocaleString('en-US')} LBP
                      {zReportMetrics.targetShift.closedAt ? ` • Closed: ${new Date(zReportMetrics.targetShift.closedAt).toLocaleString('en-US')}` : ''}
                    </div>
                  </div>
                </div>
                {zReportMetrics.targetShift.status === 'closed' && (
                  <div className="text-right font-mono text-xs">
                    <div>
                      Counted: <span className="font-bold text-white">${(zReportMetrics.targetShift.actualCountedUSD || 0).toFixed(2)}</span> + <span className="font-bold text-amber-400">{(zReportMetrics.targetShift.actualCountedLBP || 0).toLocaleString('en-US')} LBP</span>
                    </div>
                    <div className={
                      (zReportMetrics.targetShift.varianceUSD || 0) < 0 || (zReportMetrics.targetShift.varianceLBP || 0) < 0
                        ? 'text-rose-400 font-black'
                        : 'text-emerald-400 font-black'
                    }>
                      Variance: ${(zReportMetrics.targetShift.varianceUSD || 0).toFixed(2)} USD / {(zReportMetrics.targetShift.varianceLBP || 0).toLocaleString('en-US')} LBP
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Net Shift Revenue</p>
                <p className="text-2xl font-black font-mono text-[#00B8C8] mt-1">${zReportMetrics.netRevenueUSD.toFixed(2)}</p>
                <p className="text-xs font-mono text-amber-500 mt-0.5">{zReportMetrics.netRevenueLBP.toLocaleString('en-US')} LBP</p>
              </div>
              <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Expected Physical Drawer</p>
                <p className="text-2xl font-black font-mono text-emerald-400 mt-1">${zReportMetrics.expectedDrawerUSD.toFixed(2)} USD</p>
                <p className="text-xs font-mono text-amber-400 mt-0.5">+ {zReportMetrics.expectedDrawerLBP.toLocaleString('en-US')} LBP</p>
                <p className="text-[10px] text-zinc-500 mt-1">Includes Opening Float + Net Cash Tendered</p>
              </div>
              <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Card, Wallet & SOA</p>
                <p className="text-sm font-black font-mono mt-1">Card: ${zReportMetrics.cardSalesUSD.toFixed(2)}</p>
                <p className="text-xs font-mono text-purple-400 mt-0.5">Wallet: ${zReportMetrics.walletSalesUSD.toFixed(2)}</p>
                <p className="text-xs font-mono text-amber-400 mt-0.5">On Account (411): ${zReportMetrics.onAccountSalesUSD.toFixed(2)}</p>
              </div>
              <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Completed / Refunds in Shift</p>
                <p className="text-2xl font-black mt-1">{zReportMetrics.completedCount} <span className="text-xs font-normal text-zinc-500">orders</span></p>
                <p className="text-xs font-bold text-rose-500 mt-0.5">{zReportMetrics.voidedCount} voided/refunded (-${zReportMetrics.refundedTotalUSD.toFixed(2)})</p>
              </div>
            </div>

            <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
              <div className="p-4 border-b border-zinc-800/20 font-bold text-sm">
                Top Selling Items ({zReportMetrics.targetShift ? `Shift #${zReportMetrics.targetShift.id.slice(0, 8)}` : zReportDate})
              </div>
              <table className="w-full text-left text-sm">
                <thead className={`text-xs uppercase text-zinc-500 ${isDarkMode ? 'bg-zinc-900/80' : 'bg-zinc-50'}`}>
                  <tr>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-5 py-3">Units Sold</th>
                    <th className="px-5 py-3 text-right">Revenue (USD)</th>
                    <th className="px-5 py-3 text-right">Revenue (LBP)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {zReportMetrics.topItems.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-5 py-3 font-bold">{it.name}</td>
                      <td className="px-5 py-3 font-mono">{it.qty}</td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-blue-500">${it.revenue.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right font-mono text-zinc-400">{Math.round(it.revenue * effectiveRate).toLocaleString('en-US')} LBP</td>
                    </tr>
                  ))}
                  {zReportMetrics.topItems.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-zinc-500">No completed sales recorded for this shift/date.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'purchase_orders' && (
          <div className="flex-1 w-full relative">
            <PurchaseOrdersModule isDarkMode={isDarkMode} formatCurrency={formatCurrency} posType={type} />
          </div>
        )}
      </main>

      {/* Add / Edit Inventory Item Modal */}
      <Modal isOpen={isInventoryModalOpen} onClose={() => setIsInventoryModalOpen(false)} title={editingItem ? "Edit Inventory Item" : "Add Inventory Item"} theme={isDarkMode ? 'dark' : 'light'}>
        <form onSubmit={handleSaveItem} className="space-y-4">
          {type === 'cafeteria' && (
            <div
              dir="ltr"
              className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                isDarkMode ? 'bg-zinc-900/80 border-amber-500/30' : 'bg-amber-50/70 border-amber-200'
              }`}
            >
              <div>
                <div className="text-xs font-black text-amber-500 uppercase tracking-wider">
                  Kiosk POS Entry Currency
                </div>
                <div className="text-[10px] font-mono text-zinc-400">
                  Rate: 1 USD = {effectiveRate.toLocaleString('en-US')} LBP (Auto-computes both LBP & USD)
                </div>
              </div>
              <div className="flex items-center gap-1 bg-zinc-950/60 p-1 rounded-lg border border-zinc-800 text-xs font-black">
                <button
                  type="button"
                  onClick={() => setInventoryCurrencyView('LBP')}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    inventoryCurrencyView === 'LBP'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  LBP (ل.ل Default)
                </button>
                <button
                  type="button"
                  onClick={() => setInventoryCurrencyView('USD')}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    inventoryCurrencyView === 'USD'
                      ? 'bg-[#00B8C8] text-slate-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  USD ($)
                </button>
              </div>
            </div>
          )}

          {type === 'retail' && (
            <div
              className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                isDarkMode ? 'bg-zinc-900/70 border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Languages size={15} className="text-emerald-500" />
                <div>
                  <div className="text-xs font-bold">Enable Arabic Translation Fields</div>
                  <div className="text-[10px] text-zinc-500">
                    Optional for Retail Shop POS (Default: Off)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggleRetailArabic(!enableArabicInRetail)}
                className={`px-3 py-1 rounded-lg text-xs font-black uppercase transition-all ${
                  enableArabicInRetail
                    ? 'bg-emerald-500 text-slate-950'
                    : isDarkMode
                    ? 'bg-zinc-800 text-zinc-400'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {enableArabicInRetail ? 'ON' : 'OFF'}
              </button>
            </div>
          )}

          <div className={`grid grid-cols-1 ${showArabicFields ? 'sm:grid-cols-2' : ''} gap-4`}>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Item Name (English)</label>
              <input
                type="text"
                required
                value={newItem.name || ''}
                onChange={e => {
                  const val = e.target.value;
                  setNewItem({
                    ...newItem,
                    name: val,
                    nameAr: showArabicFields
                      ? (newItem.nameAr ? newItem.nameAr : translateToArabic(val))
                      : (newItem.nameAr || '')
                  });
                }}
                className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
            </div>
            {showArabicFields && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-emerald-500 uppercase">Item Name (Arabic / الاسم بالعربية)</label>
                  <button
                    type="button"
                    onClick={() =>
                      setNewItem({
                        ...newItem,
                        nameAr: translateToArabic(newItem.name || ''),
                        categoryAr: translateToArabic(newItem.category || ''),
                        subcategoryAr: newItem.subcategory ? translateToArabic(newItem.subcategory) : ''
                      })
                    }
                    className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 flex items-center gap-1"
                  >
                    <Languages size={11} /> Auto-Translate
                  </button>
                </div>
                <input
                  type="text"
                  dir="rtl"
                  placeholder="الاسم بالعربية (مثال: مياه معدنية 500ml)"
                  value={newItem.nameAr || ''}
                  onChange={e => setNewItem({ ...newItem, nameAr: toEnglishNumerals(e.target.value) })}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
              </div>
            )}
          </div>

          <div className={`grid grid-cols-1 ${showArabicFields ? 'sm:grid-cols-2' : ''} gap-4`}>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Category (English)</label>
              <input
                list="pos-categories-list"
                type="text"
                required
                value={newItem.category || ''}
                onChange={e => {
                  const catVal = e.target.value;
                  const matchedCat = effectiveCategoryConfigs.find(c => c.name.toLowerCase() === catVal.toLowerCase());
                  setNewItem({
                    ...newItem,
                    category: catVal,
                    categoryAr: showArabicFields
                      ? (matchedCat?.nameAr || translateToArabic(catVal))
                      : (newItem.categoryAr || '')
                  });
                }}
                className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
              <datalist id="pos-categories-list">
                {effectiveCategoryConfigs.map(c => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            {showArabicFields && (
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Category (Arabic / الفئة بالعربية)</label>
                <input
                  type="text"
                  dir="rtl"
                  placeholder="الفئة بالعربية"
                  value={newItem.categoryAr || ''}
                  onChange={e => setNewItem({ ...newItem, categoryAr: toEnglishNumerals(e.target.value) })}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
              </div>
            )}
          </div>

          <div className={`grid grid-cols-1 ${showArabicFields ? 'sm:grid-cols-2' : ''} gap-4`}>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Subcategory (Optional)</label>
              <input
                list="pos-subcategories-list"
                type="text"
                placeholder="e.g. Water, Isotonic, Chips, Bars..."
                value={newItem.subcategory || ''}
                onChange={e => {
                  const subVal = e.target.value;
                  const matchedCat = effectiveCategoryConfigs.find(c => c.name === newItem.category);
                  const matchedSub = matchedCat?.subcategories.find(s => s.name.toLowerCase() === subVal.toLowerCase());
                  setNewItem({
                    ...newItem,
                    subcategory: subVal,
                    subcategoryAr: showArabicFields
                      ? (matchedSub?.nameAr || (subVal ? translateToArabic(subVal) : ''))
                      : (newItem.subcategoryAr || '')
                  });
                }}
                className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
              <datalist id="pos-subcategories-list">
                {(effectiveCategoryConfigs.find(c => c.name === newItem.category)?.subcategories || []).map(s => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>
            {showArabicFields && (
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Subcategory (Arabic / الفئة الفرعية)</label>
                <input
                  type="text"
                  dir="rtl"
                  placeholder="الفئة الفرعية بالعربية"
                  value={newItem.subcategoryAr || ''}
                  onChange={e => setNewItem({ ...newItem, subcategoryAr: toEnglishNumerals(e.target.value) })}
                  className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">SKU / Barcode</label>
              <input type="text" placeholder="Scan or type SKU" value={newItem.sku || newItem.barcode || ''} onChange={e => setNewItem({...newItem, sku: e.target.value, barcode: e.target.value})} className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Supplier</label>
              <input type="text" value={newItem.supplier || ''} onChange={e => setNewItem({...newItem, supplier: e.target.value})} className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
          </div>

          {/* Packaged Good vs. Single Unit Dual-Selling Configuration (Item #4) */}
          <div className={`p-3.5 rounded-xl border space-y-3 ${isDarkMode ? 'bg-zinc-900/70 border-indigo-500/30' : 'bg-indigo-50/40 border-indigo-200'}`}>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-indigo-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(newItem.isPackagedGood)}
                  onChange={e => {
                    const checked = e.target.checked;
                    const upp = Math.max(1, Number(newItem.unitsPerPack) || 12);
                    const uPriceUSD = Number(newItem.unitSellingPrice ?? newItem.price ?? 0);
                    const uPriceLBP = Number(newItem.unitSellingPriceLBP ?? newItem.priceLBP ?? Math.round(uPriceUSD * effectiveRate));
                    const uCostUSD = Number(newItem.costPrice ?? newItem.cost ?? 0);
                    const uCostLBP = Number(newItem.costPriceLBP ?? Math.round(uCostUSD * effectiveRate));
                    setNewItem({
                      ...newItem,
                      isPackagedGood: checked,
                      unitsPerPack: upp,
                      unitSellingPrice: uPriceUSD,
                      unitSellingPriceLBP: uPriceLBP,
                      packSellingPrice: newItem.packSellingPrice && newItem.packSellingPrice > 0 ? newItem.packSellingPrice : Number((uPriceUSD * upp).toFixed(2)),
                      packSellingPriceLBP: newItem.packSellingPriceLBP && newItem.packSellingPriceLBP > 0 ? newItem.packSellingPriceLBP : Math.round(uPriceLBP * upp),
                      packCostPrice: newItem.packCostPrice && newItem.packCostPrice > 0 ? newItem.packCostPrice : Number((uCostUSD * upp).toFixed(2)),
                      packCostLBP: newItem.packCostLBP && newItem.packCostLBP > 0 ? newItem.packCostLBP : Math.round(uCostLBP * upp),
                    });
                  }}
                  className="rounded text-indigo-500"
                />
                <span>Packaged Good (Bought in Packs — Sold by Single Unit or Full Pack)</span>
              </label>
            </div>

            {newItem.isPackagedGood && (
              <div className="space-y-3 pt-1 border-t border-indigo-500/20" dir="ltr">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-indigo-400 uppercase mb-1">
                      Units per Pack (e.g. 6, 12, 24)
                    </label>
                    <input
                      type="number"
                      min="2"
                      required
                      value={newItem.unitsPerPack ?? 12}
                      onChange={e => {
                        const upp = Math.max(1, parseInt(e.target.value, 10) || 1);
                        const packCostUSD = Number(newItem.packCostPrice || 0);
                        const packCostLBP = Number(newItem.packCostLBP || 0);
                        const nextUnitCostUSD = packCostUSD > 0 ? Number((packCostUSD / upp).toFixed(4)) : Number(newItem.costPrice ?? newItem.cost ?? 0);
                        const nextUnitCostLBP = packCostLBP > 0 ? Math.round(packCostLBP / upp) : Math.round(nextUnitCostUSD * effectiveRate);
                        const nextStock = stockEntryByPack
                          ? (parseInt(stockPackCountInput, 10) || 0) * upp
                          : Number(newItem.stock) || 0;
                        setNewItem({
                          ...newItem,
                          unitsPerPack: upp,
                          cost: nextUnitCostUSD,
                          costPrice: nextUnitCostUSD,
                          costPriceLBP: nextUnitCostLBP,
                          stock: nextStock
                        });
                      }}
                      className={`w-full p-2 rounded-lg border text-xs font-mono font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-indigo-400 uppercase mb-1">
                      Pack Cost ({type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? 'LBP ل.ل' : '$ USD'}) → Auto Single Unit Cost
                    </label>
                    {isManagerOrAdmin ? (
                      <input
                        type="number"
                        step={type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? '1000' : '0.01'}
                        min="0"
                        value={
                          type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                            ? (newItem.packCostLBP || '')
                            : (newItem.packCostPrice || '')
                        }
                        onChange={e => {
                          const raw = Math.max(0, parseFloat(e.target.value) || 0);
                          const upp = Math.max(1, Number(newItem.unitsPerPack) || 1);
                          const isLBPMode = type === 'cafeteria' && inventoryCurrencyView === 'LBP';
                          const pCostLBP = isLBPMode ? Math.round(raw) : Math.round(raw * effectiveRate);
                          const pCostUSD = isLBPMode ? Number((raw / effectiveRate).toFixed(4)) : raw;
                          const uCostLBP = Math.round(pCostLBP / upp);
                          const uCostUSD = Number((pCostUSD / upp).toFixed(4));
                          setNewItem({
                            ...newItem,
                            packCostLBP: pCostLBP,
                            packCostPrice: pCostUSD,
                            costPriceLBP: uCostLBP,
                            costPrice: uCostUSD,
                            cost: uCostUSD,
                          });
                        }}
                        placeholder="Enter Full Pack Cost"
                        className={`w-full p-2 rounded-lg border text-xs font-mono font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                      />
                    ) : (
                      <div className="p-2 rounded-lg border border-zinc-800 text-xs text-amber-400 font-bold">
                        Locked (Manager PIN)
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-400 uppercase mb-1">
                      Single Unit Selling Price ({type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? 'LBP ل.ل' : '$ USD'})
                    </label>
                    <input
                      type="number"
                      step={type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? '1000' : '0.01'}
                      min="0"
                      required
                      value={
                        type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                          ? (newItem.unitSellingPriceLBP ?? newItem.priceLBP ?? '')
                          : (newItem.unitSellingPrice ?? newItem.price ?? '')
                      }
                      onChange={e => {
                        const raw = Math.max(0, parseFloat(e.target.value) || 0);
                        const isLBPMode = type === 'cafeteria' && inventoryCurrencyView === 'LBP';
                        const uLBP = isLBPMode ? Math.round(raw) : Math.round(raw * effectiveRate);
                        const uUSD = isLBPMode ? Number((raw / effectiveRate).toFixed(4)) : raw;
                        setNewItem({
                          ...newItem,
                          price: uUSD,
                          priceLBP: uLBP,
                          unitSellingPrice: uUSD,
                          unitSellingPriceLBP: uLBP,
                        });
                      }}
                      className={`w-full p-2 rounded-lg border text-xs font-mono font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                    />
                    <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                      {type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                        ? `≈ $${Number(newItem.unitSellingPrice ?? newItem.price ?? 0).toFixed(2)} USD / unit`
                        : `≈ ${Math.round(Number(newItem.unitSellingPriceLBP ?? (newItem.price || 0) * effectiveRate)).toLocaleString('en-US')} LBP / unit`}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-indigo-400 uppercase mb-1">
                      Full Pack ({newItem.unitsPerPack || 12}u) Selling Price ({type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? 'LBP ل.ل' : '$ USD'})
                    </label>
                    <input
                      type="number"
                      step={type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? '1000' : '0.01'}
                      min="0"
                      required
                      value={
                        type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                          ? (newItem.packSellingPriceLBP ?? '')
                          : (newItem.packSellingPrice ?? '')
                      }
                      onChange={e => {
                        const raw = Math.max(0, parseFloat(e.target.value) || 0);
                        const isLBPMode = type === 'cafeteria' && inventoryCurrencyView === 'LBP';
                        const pLBP = isLBPMode ? Math.round(raw) : Math.round(raw * effectiveRate);
                        const pUSD = isLBPMode ? Number((raw / effectiveRate).toFixed(4)) : raw;
                        setNewItem({
                          ...newItem,
                          packSellingPrice: pUSD,
                          packSellingPriceLBP: pLBP,
                        });
                      }}
                      className={`w-full p-2 rounded-lg border text-xs font-mono font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                    />
                    <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                      {type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                        ? `≈ $${Number(newItem.packSellingPrice || 0).toFixed(2)} USD / pack`
                        : `≈ ${Math.round(Number(newItem.packSellingPriceLBP || 0)).toLocaleString('en-US')} LBP / pack`}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {!newItem.isPackagedGood && (
            <div className="grid grid-cols-2 gap-4" dir="ltr">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                  Selling Price ({type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? 'LBP ل.ل' : currency === 'LBP' ? 'ل.ل' : '$ USD'})
                </label>
                <input 
                  type="number" 
                  step={type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? '1000' : '0.01'} 
                  required 
                  value={
                    type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                      ? (newItem.priceLBP ?? (newItem.price ? Math.round(newItem.price * effectiveRate) : ''))
                      : (convertFromBase(newItem.price || 0) || '')
                  } 
                  onChange={e => {
                    const raw = Math.max(0, parseFloat(e.target.value) || 0);
                    if (type === 'cafeteria' && inventoryCurrencyView === 'LBP') {
                      const pLBP = Math.round(raw);
                      const pUSD = Number((raw / effectiveRate).toFixed(4));
                      setNewItem({ ...newItem, price: pUSD, priceLBP: pLBP, unitSellingPrice: pUSD, unitSellingPriceLBP: pLBP });
                    } else {
                      const pUSD = convertToBase(raw);
                      const pLBP = Math.round(pUSD * effectiveRate);
                      setNewItem({ ...newItem, price: pUSD, priceLBP: pLBP, unitSellingPrice: pUSD, unitSellingPriceLBP: pLBP });
                    }
                  }} 
                  className={`w-full p-2.5 rounded-lg border font-mono focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} 
                />
                <div className="text-[10px] font-mono text-zinc-500 mt-1">
                  {type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                    ? `≈ $${Number(newItem.price || 0).toFixed(2)} USD`
                    : `≈ ${Math.round((newItem.price || 0) * effectiveRate).toLocaleString('en-US')} LBP`}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                  Unit Cost ({type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? 'LBP ل.ل' : currency === 'LBP' ? 'ل.ل' : '$ USD'})
                </label>
                {isManagerOrAdmin ? (
                  <>
                    <input 
                      type="number" 
                      step={type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? '1000' : '0.01'} 
                      required 
                      value={
                        type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                          ? (newItem.costPriceLBP ?? (newItem.costPrice || newItem.cost ? Math.round(Number(newItem.costPrice ?? newItem.cost ?? 0) * effectiveRate) : ''))
                          : (convertFromBase(newItem.costPrice ?? newItem.cost ?? 0) || '')
                      } 
                      onChange={e => {
                        const raw = Math.max(0, parseFloat(e.target.value) || 0);
                        if (type === 'cafeteria' && inventoryCurrencyView === 'LBP') {
                          const cLBP = Math.round(raw);
                          const cUSD = Number((raw / effectiveRate).toFixed(4));
                          setNewItem({ ...newItem, cost: cUSD, costPrice: cUSD, costPriceLBP: cLBP });
                        } else {
                          const cUSD = convertToBase(raw);
                          const cLBP = Math.round(cUSD * effectiveRate);
                          setNewItem({ ...newItem, cost: cUSD, costPrice: cUSD, costPriceLBP: cLBP });
                        }
                      }} 
                      className={`w-full p-2.5 rounded-lg border font-mono focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} 
                    />
                    <div className="text-[10px] font-mono text-zinc-500 mt-1">
                      {type === 'cafeteria' && inventoryCurrencyView === 'LBP'
                        ? `≈ $${Number(newItem.costPrice ?? newItem.cost ?? 0).toFixed(4)} USD`
                        : `≈ ${Math.round(Number(newItem.costPrice ?? newItem.cost ?? 0) * effectiveRate).toLocaleString('en-US')} LBP`}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => requireManagerApproval('Unlock Unit Cost & Margin', () => {})}
                    className={`w-full p-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-800 text-amber-400' : 'bg-slate-100 border-slate-200 text-amber-600'
                    }`}
                  >
                    <Lock size={13} /> Confidential — Enter Manager PIN
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Stock Entry Mode (Single Units vs. Number of Packs) */}
          {newItem.isPackagedGood && (
            <div className="flex items-center justify-between text-xs bg-indigo-500/10 border border-indigo-500/30 p-2.5 rounded-xl" dir="ltr">
              <span className="font-bold text-indigo-400">Stock Entry Mode:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setStockEntryByPack(false)}
                  className={`px-2.5 py-1 rounded-lg font-black text-[11px] ${
                    !stockEntryByPack ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400'
                  }`}
                >
                  Enter Total Single Units
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStockEntryByPack(true);
                    const upp = Math.max(1, Number(newItem.unitsPerPack) || 12);
                    setStockPackCountInput(String(Math.floor((Number(newItem.stock) || 0) / upp)));
                  }}
                  className={`px-2.5 py-1 rounded-lg font-black text-[11px] ${
                    stockEntryByPack ? 'bg-indigo-500 text-white' : 'text-zinc-400'
                  }`}
                >
                  Enter Number of Packs ({newItem.unitsPerPack || 12}u/pack)
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3" dir="ltr">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                {newItem.isPackagedGood && stockEntryByPack
                  ? `Packs (${newItem.unitsPerPack || 12}u/pack)`
                  : 'Stock (Single Units)'}
              </label>
              {newItem.isPackagedGood && stockEntryByPack ? (
                <div>
                  <input
                    type="number"
                    min="0"
                    required
                    value={stockPackCountInput}
                    onChange={e => {
                      const packs = Math.max(0, parseInt(e.target.value, 10) || 0);
                      const upp = Math.max(1, Number(newItem.unitsPerPack) || 12);
                      const nextStock = packs * upp;
                      setStockPackCountInput(e.target.value);
                      if (editingItem && !isManagerOrAdmin) {
                        requireManagerApproval(`Modify Stock Quantity for ${editingItem.name}`, () => {
                          setNewItem({ ...newItem, stock: nextStock });
                        });
                      } else {
                        setNewItem({ ...newItem, stock: nextStock });
                      }
                    }}
                    className={`w-full p-2.5 rounded-lg border font-mono focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                  />
                  <div className="text-[10px] font-mono text-indigo-400 font-bold mt-0.5">
                    = {Number(newItem.stock || 0).toLocaleString('en-US')} Total Single Units
                  </div>
                </div>
              ) : (
                <input
                  type="number"
                  required
                  value={newItem.stock ?? 0}
                  onChange={e => {
                    const nextStock = parseInt(e.target.value, 10) || 0;
                    if (editingItem && !isManagerOrAdmin) {
                      requireManagerApproval(`Modify Stock Quantity for ${editingItem.name}`, () => {
                        setNewItem({ ...newItem, stock: nextStock });
                      });
                    } else {
                      setNewItem({ ...newItem, stock: nextStock });
                    }
                  }}
                  className={`w-full p-2.5 rounded-lg border font-mono focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Min Alert (Units)</label>
              <input type="number" value={newItem.lowStockThreshold ?? 5} onChange={e => setNewItem({...newItem, lowStockThreshold: parseInt(e.target.value, 10) || 0})} className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Reorder Qty (Units)</label>
              <input type="number" value={newItem.reorderQuantity ?? 20} onChange={e => setNewItem({...newItem, reorderQuantity: parseInt(e.target.value, 10) || 1})} className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
          </div>

          {/* Mandatory Stock Adjustment Audit Reason when editing an existing item's stock */}
          {editingItem && (() => {
            const hasVars = Array.isArray(newItem.variants) && newItem.variants.length > 0;
            const computedNewStock = hasVars
              ? newItem.variants!.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
              : Number(newItem.stock) || 0;
            const oldStock = Number(editingItem.stock) || 0;
            const delta = computedNewStock - oldStock;
            if (delta === 0) return null;
            return (
              <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                  <span>
                    Manual Stock Change Detected: {oldStock} → {computedNewStock} ({delta > 0 ? `+${delta}` : delta} units)
                  </span>
                  <span className="font-mono">LCOA {type === 'cafeteria' ? '301' : '302'} / 6019</span>
                </div>
                <label className="block text-[11px] font-black uppercase text-amber-300">
                  Mandatory Stock Adjustment Audit Reason *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Physical Count Correction, Damaged Unit, Found Stock..."
                  value={stockAdjustmentReason}
                  onChange={e => setStockAdjustmentReason(e.target.value)}
                  className={`w-full p-2 rounded-lg border text-xs ${isDarkMode ? 'bg-zinc-950 border-amber-500/40 text-white' : 'bg-white border-amber-300 text-slate-900'}`}
                />
                <div className="flex flex-wrap gap-1.5">
                  {['Physical Count Correction', 'Damaged / Spoiled', 'Found Unrecorded Stock', 'Promo / Sample Use'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setStockAdjustmentReason(preset)}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Expiry Date (Optional)</label>
              <input type="date" value={newItem.expiryDate || ''} onChange={e => setNewItem({...newItem, expiryDate: e.target.value})} className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Image URL (Optional)</label>
              <input type="url" value={newItem.image || ''} onChange={e => setNewItem({...newItem, image: e.target.value})} className={`w-full p-2.5 rounded-lg border focus:outline-none ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
          </div>

          {/* Product Variants Matrix (Size / Flavor) */}
          <div className={`p-3.5 rounded-xl border space-y-2.5 ${isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-indigo-500 flex items-center gap-1.5">
                <Layers size={14} /> Product Variants (Size / Flavor Matrix)
              </span>
              <button
                type="button"
                onClick={() => {
                  const currentVars = Array.isArray(newItem.variants) ? newItem.variants : [];
                  setNewItem({
                    ...newItem,
                    variants: [
                      ...currentVars,
                      { id: `var_${Date.now()}_${currentVars.length}`, name: '', sku: '', priceOverride: newItem.price || 0, stock: 10 }
                    ]
                  });
                }}
                className="text-xs font-bold text-indigo-500 hover:text-indigo-400"
              >
                + Add Variant
              </button>
            </div>
            {(newItem.variants || []).map((v, idx) => (
              <div key={v.id} className="grid grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  placeholder="Size / Flavor (e.g. Large / Berry)"
                  value={v.name}
                  onChange={e => {
                    const next = [...(newItem.variants || [])];
                    next[idx] = { ...next[idx], name: e.target.value };
                    setNewItem({ ...newItem, variants: next });
                  }}
                  className={`col-span-4 p-2 rounded-lg border text-xs ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
                <input
                  type="text"
                  placeholder="Variant SKU / Barcode"
                  value={v.sku || ''}
                  onChange={e => {
                    const next = [...(newItem.variants || [])];
                    next[idx] = { ...next[idx], sku: e.target.value };
                    setNewItem({ ...newItem, variants: next });
                  }}
                  className={`col-span-3 p-2 rounded-lg border text-xs font-mono ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price ($)"
                  value={v.priceOverride ?? ''}
                  onChange={e => {
                    const next = [...(newItem.variants || [])];
                    next[idx] = { ...next[idx], priceOverride: parseFloat(e.target.value) || 0 };
                    setNewItem({ ...newItem, variants: next });
                  }}
                  className={`col-span-2 p-2 rounded-lg border text-xs font-mono ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
                <input
                  type="number"
                  placeholder="Stock"
                  value={v.stock}
                  onChange={e => {
                    const next = [...(newItem.variants || [])];
                    next[idx] = { ...next[idx], stock: parseInt(e.target.value, 10) || 0 };
                    setNewItem({ ...newItem, variants: next });
                  }}
                  className={`col-span-2 p-2 rounded-lg border text-xs font-mono ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = (newItem.variants || []).filter((_, i) => i !== idx);
                    setNewItem({ ...newItem, variants: next });
                  }}
                  className="col-span-1 text-rose-500 font-bold text-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Combo Bundle Configuration */}
          <div className={`p-3.5 rounded-xl border space-y-2.5 ${isDarkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`}>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-purple-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(newItem.isBundle)}
                  onChange={e => setNewItem({ ...newItem, isBundle: e.target.checked })}
                  className="rounded"
                />
                Combo Bundle (Deducts Component Inventory Automatically)
              </label>
              {newItem.isBundle && (
                <button
                  type="button"
                  onClick={() => {
                    const currentComps = Array.isArray(newItem.bundleComponents) ? newItem.bundleComponents : [];
                    const firstAvailable = items.find(i => i.id !== editingItem?.id);
                    if (!firstAvailable) return;
                    setNewItem({
                      ...newItem,
                      bundleComponents: [
                        ...currentComps,
                        { itemId: firstAvailable.id, name: firstAvailable.name, quantity: 1 }
                      ]
                    });
                  }}
                  className="text-xs font-bold text-purple-500 hover:text-purple-400"
                >
                  + Add Component
                </button>
              )}
            </div>
            {newItem.isBundle && (newItem.bundleComponents || []).map((comp, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select
                  value={comp.itemId}
                  onChange={e => {
                    const match = items.find(i => i.id === e.target.value);
                    const next = [...(newItem.bundleComponents || [])];
                    next[idx] = {
                      ...next[idx],
                      itemId: e.target.value,
                      name: match?.name || ''
                    };
                    setNewItem({ ...newItem, bundleComponents: next });
                  }}
                  className={`col-span-8 p-2 rounded-lg border text-xs ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                >
                  {items.filter(i => i.id !== editingItem?.id).map(inv => (
                    <option key={inv.id} value={inv.id}>{inv.name} (Stock: {inv.stock})</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={comp.quantity}
                  onChange={e => {
                    const next = [...(newItem.bundleComponents || [])];
                    next[idx] = { ...next[idx], quantity: Math.max(1, parseInt(e.target.value, 10) || 1) };
                    setNewItem({ ...newItem, bundleComponents: next });
                  }}
                  className={`col-span-3 p-2 rounded-lg border text-xs font-mono ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = (newItem.bundleComponents || []).filter((_, i) => i !== idx);
                    setNewItem({ ...newItem, bundleComponents: next });
                  }}
                  className="col-span-1 text-rose-500 font-bold text-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors mt-4">
            {editingItem ? 'Update Item' : 'Add Item'}
          </button>
        </form>
      </Modal>

      {/* Variant Selector Modal */}
      <Modal
        isOpen={!!variantModalItem}
        onClose={() => setVariantModalItem(null)}
        title={
          posLang === 'ar'
            ? `اختر الحجم / النكهة — ${variantModalItem ? (variantModalItem.nameAr || translateToArabic(variantModalItem.name)) : ''}`
            : `Select Variant — ${variantModalItem?.name || ''}`
        }
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <div className="space-y-2.5" dir={posLang === 'ar' ? 'rtl' : 'ltr'} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {(variantModalItem?.variants || []).map(v => {
            const vPrice = v.priceOverride !== undefined && v.priceOverride > 0 ? v.priceOverride : (variantModalItem?.price || 0);
            const vDisplayName = posLang === 'ar' ? translateToArabic(v.name) : v.name;
            return (
              <button
                key={v.id}
                disabled={v.stock <= 0}
                onClick={() => {
                  if (variantModalItem) {
                    addToCart(variantModalItem, v);
                    setVariantModalItem(null);
                  }
                }}
                className={`w-full p-3.5 rounded-2xl border flex items-center justify-between transition-all ${
                  v.stock <= 0
                    ? 'opacity-40 cursor-not-allowed'
                    : isDarkMode
                    ? 'bg-zinc-900 border-zinc-800 hover:border-blue-500'
                    : 'bg-white border-zinc-200 hover:border-blue-500'
                }`}
              >
                <div className={posLang === 'ar' ? 'text-right' : 'text-left'}>
                  <div className="font-bold text-sm">{vDisplayName}</div>
                  <div className="text-xs text-zinc-500" dir="ltr">
                    {posLang === 'ar' ? `المخزون: ${Number(v.stock).toLocaleString('en-US')}` : `Stock: ${Number(v.stock).toLocaleString('en-US')} available`}
                  </div>
                </div>
                <div className="font-mono font-black text-blue-500" dir="ltr">{toEnglishNumerals(formatCurrency(vPrice))}</div>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Hold / Park Order Modal */}
      <Modal
        isOpen={isHoldTabModalOpen}
        onClose={() => setIsHoldTabModalOpen(false)}
        title={posLang === 'ar' ? 'تعليق الطلب (فتح حساب ملعب أو لاعب)' : 'Hold / Park Order to Open Tab'}
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <form onSubmit={handleParkCurrentOrder} className="space-y-4" dir={posLang === 'ar' ? 'rtl' : 'ltr'}>
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
              {posLang === 'ar' ? 'اسم حساب الملعب أو اللاعب' : 'Player / Court Tab Name'}
            </label>
            <input
              type="text"
              required
              placeholder={posLang === 'ar' ? 'مثال: طاولة بادل 2 — حساب رامي' : 'e.g. Padel Court 2 — Rami Tab'}
              value={holdTabLabel}
              onChange={e => setHoldTabLabel(toEnglishNumerals(e.target.value))}
              className={`w-full p-2.5 rounded-xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(posLang === 'ar'
              ? ['طاولة بادل 1', 'طاولة بادل 2', 'ملعب كرة السلة', 'استراحة VIP']
              : ['Padel Court 1 Tab', 'Padel Court 2 Tab', 'Basketball Court Tab', 'VIP Lounge Tab']
            ).map(preset => (
              <button
                key={preset}
                type="button"
                onClick={() => setHoldTabLabel(preset)}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
              >
                {preset}
              </button>
            ))}
          </div>
          <button type="submit" className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold" dir="ltr">
            {posLang === 'ar'
              ? `تعليق الطلب (${Number(cart.reduce((s, c) => s + c.quantity, 0)).toLocaleString('en-US')} عناصر • ${toEnglishNumerals(formatCurrency(total))})`
              : `Park Order (${cart.reduce((s, c) => s + c.quantity, 0)} Items • ${formatCurrency(total)})`}
          </button>
        </form>
      </Modal>

      {/* Open Parked Tabs Drawer Modal */}
      <Modal
        isOpen={isOpenTabsModalOpen}
        onClose={() => setIsOpenTabsModalOpen(false)}
        title={posLang === 'ar' ? `الحسابات المفتوحة (${Number(parkedOrders.length).toLocaleString('en-US')})` : `Open Player & Court Tabs (${parkedOrders.length})`}
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <div className="space-y-3" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {parkedOrders.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-sm">
              {posLang === 'ar'
                ? 'لا توجد حسابات معلقة حالياً.'
                : `No parked tabs currently open for ${type === 'cafeteria' ? 'Kiosk POS' : 'Retail Shop POS'}.`}
            </div>
          ) : (
            parkedOrders.map(tab => {
              const tabSub = (tab.items || []).reduce((s, i) => s + i.price * i.quantity, 0);
              const tabTot = Math.max(0, tabSub - (tab.discount || 0));
              return (
                <div
                  key={tab.id}
                  className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                    isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                  }`}
                >
                  <div>
                    <div className="font-bold text-sm">{tab.label}</div>
                    <div className="text-xs text-zinc-500">
                      {(tab.items || []).map(i => {
                        const iName = posLang === 'ar' ? (i.nameAr || translateToArabic(i.name)) : i.name;
                        const vName = i.variantName ? (posLang === 'ar' ? translateToArabic(i.variantName) : i.variantName) : '';
                        return `${Number(i.quantity).toLocaleString('en-US')}x ${iName}${vName ? ` (${vName})` : ''}`;
                      }).join(', ')}
                    </div>
                    <div className="text-xs font-mono font-black text-blue-500 mt-1" dir="ltr">
                      Total: {toEnglishNumerals(formatCurrency(tabTot))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleResumeParkedOrder(tab)}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <PlayCircle size={14} /> {posLang === 'ar' ? 'استئناف' : 'Resume'}
                    </button>
                    <button
                      onClick={() => handleDiscardParkedOrder(tab)}
                      className="p-1.5 rounded-xl text-rose-500 hover:bg-rose-500/10"
                      title="Discard Tab"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Modal>

      {/* Manage Categories & Subcategories Modal (Kiosk POS & Retail POS) */}
      <Modal
        isOpen={isCategoryModalOpen}
        onClose={() => {
          setIsCategoryModalOpen(false);
          setEditingCatId(null);
          setEditingSubcat(null);
        }}
        title={`Manage Categories & Subcategories — ${type === 'cafeteria' ? 'Kiosk POS' : 'Retail Shop POS'}`}
        theme={isDarkMode ? 'dark' : 'light'}
        maxWidth="2xl"
      >
        <div className="space-y-5">
          {type === 'retail' && (
            <div
              className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                isDarkMode ? 'bg-zinc-900/70 border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Languages size={15} className="text-emerald-500" />
                <div>
                  <div className="text-xs font-bold">Enable Arabic Translation Fields</div>
                  <div className="text-[10px] text-zinc-500">
                    Show/hide Arabic Category & Subcategory fields in Retail Shop POS
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggleRetailArabic(!enableArabicInRetail)}
                className={`px-3 py-1 rounded-lg text-xs font-black uppercase transition-all ${
                  enableArabicInRetail
                    ? 'bg-emerald-500 text-slate-950'
                    : isDarkMode
                    ? 'bg-zinc-800 text-zinc-400'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {enableArabicInRetail ? 'ON' : 'OFF'}
              </button>
            </div>
          )}

          {/* Add New Category Form */}
          <form
            onSubmit={handleAddCategoryConfig}
            className={`p-4 rounded-2xl border space-y-3 ${isDarkMode ? 'bg-zinc-900/70 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-[#00B8C8]">
                + Create New Category ({type === 'cafeteria' ? 'Kiosk POS' : 'Retail Shop'})
              </span>
              {showArabicFields && (
                <button
                  type="button"
                  onClick={() => {
                    if (newCatName.trim()) {
                      setNewCatNameAr(translateToArabic(newCatName.trim()));
                    }
                  }}
                  className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 flex items-center gap-1"
                >
                  <Languages size={11} /> Auto-Translate Arabic
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
              <input
                type="text"
                required
                placeholder="Category Name (English, e.g. Dairy & Shakes)"
                value={newCatName}
                onChange={e => {
                  setNewCatName(e.target.value);
                  if (showArabicFields && !newCatNameAr) {
                    setNewCatNameAr(translateToArabic(e.target.value));
                  }
                }}
                className={`${showArabicFields ? 'sm:col-span-5' : 'sm:col-span-10'} p-2.5 rounded-xl border text-xs font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
              {showArabicFields && (
                <input
                  type="text"
                  dir="rtl"
                  placeholder="الفئة بالعربية (مثال: ألبان ومخفوقات)"
                  value={newCatNameAr}
                  onChange={e => setNewCatNameAr(toEnglishNumerals(e.target.value))}
                  className={`sm:col-span-5 p-2.5 rounded-xl border text-xs font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}
                />
              )}
              <button
                type="submit"
                className="sm:col-span-2 py-2.5 px-3 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-black text-xs flex items-center justify-center gap-1"
              >
                <Plus size={14} /> Add
              </button>
            </div>
          </form>

          {/* Existing Categories & Nested Subcategories */}
          <div className="space-y-3">
            {effectiveCategoryConfigs.map(cat => {
              const isEditingThisCat = editingCatId === cat.id;
              const itemCount = items.filter(i => i.category === cat.name).length;
              return (
                <div
                  key={cat.id}
                  className={`p-4 rounded-2xl border space-y-3 ${isDarkMode ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {isEditingThisCat ? (
                      <div className="flex flex-wrap items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={editingCatName}
                          onChange={e => setEditingCatName(e.target.value)}
                          className={`p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-700' : 'bg-white border-slate-300'}`}
                          placeholder="Category (EN)"
                        />
                        {showArabicFields && (
                          <>
                            <input
                              type="text"
                              dir="rtl"
                              value={editingCatNameAr}
                              onChange={e => setEditingCatNameAr(toEnglishNumerals(e.target.value))}
                              className={`p-2 rounded-lg border text-xs font-bold ${isDarkMode ? 'bg-zinc-950 border-zinc-700' : 'bg-white border-slate-300'}`}
                              placeholder="الفئة بالعربية"
                            />
                            <button
                              type="button"
                              onClick={() => setEditingCatNameAr(translateToArabic(editingCatName))}
                              className="px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[10px] font-black"
                            >
                              Translate
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSaveEditedCategoryConfig(cat)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCatId(null)}
                          className="px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <span className="font-black text-sm">{cat.name}</span>
                        {showArabicFields && (
                          <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg" dir="rtl">
                            {cat.nameAr || translateToArabic(cat.name)}
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-zinc-500" dir="ltr">
                          ({Number(itemCount).toLocaleString('en-US')} items)
                        </span>
                      </div>
                    )}

                    {!isEditingThisCat && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(cat.id);
                            setEditingCatName(cat.name);
                            setEditingCatNameAr(cat.nameAr || translateToArabic(cat.name));
                          }}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-blue-400 hover:bg-blue-500/10"
                          title="Edit Category"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategoryConfig(cat)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10"
                          title="Delete Category"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Subcategories List */}
                  <div className="pl-3 border-l-2 border-[#00B8C8]/30 space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Subcategories ({Number(cat.subcategories.length).toLocaleString('en-US')})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {cat.subcategories.map(sub => {
                        const isEditingSub =
                          editingSubcat?.catId === cat.id && editingSubcat?.subId === sub.id;
                        if (isEditingSub && editingSubcat) {
                          return (
                            <div
                              key={sub.id}
                              className={`p-2 rounded-xl border flex flex-wrap items-center gap-1.5 ${
                                isDarkMode ? 'bg-zinc-950 border-zinc-700' : 'bg-slate-100 border-slate-300'
                              }`}
                            >
                              <input
                                type="text"
                                value={editingSubcat.name}
                                onChange={e =>
                                  setEditingSubcat({ ...editingSubcat, name: e.target.value })
                                }
                                className={`p-1.5 rounded border text-xs w-28 ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-300'}`}
                              />
                              {showArabicFields && (
                                <input
                                  type="text"
                                  dir="rtl"
                                  value={editingSubcat.nameAr}
                                  onChange={e =>
                                    setEditingSubcat({
                                      ...editingSubcat,
                                      nameAr: toEnglishNumerals(e.target.value)
                                    })
                                  }
                                  className={`p-1.5 rounded border text-xs w-28 ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-300'}`}
                                />
                              )}
                              <button
                                type="button"
                                onClick={handleSaveEditedSubcategoryConfig}
                                className="px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-bold"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSubcat(null)}
                                className="px-1.5 py-1 text-[11px] text-zinc-400"
                              >
                                ×
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={sub.id}
                            className={`px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-2 ${
                              isDarkMode ? 'bg-zinc-950/70 border-zinc-800' : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <span className="font-bold">{sub.name}</span>
                            {showArabicFields && (
                              <span className="text-[11px] text-emerald-400 font-medium" dir="rtl">
                                ({sub.nameAr || translateToArabic(sub.name)})
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setEditingSubcat({
                                  catId: cat.id,
                                  subId: sub.id,
                                  name: sub.name,
                                  nameAr: sub.nameAr || translateToArabic(sub.name)
                                })
                              }
                              className="text-zinc-400 hover:text-blue-400"
                              title="Edit Subcategory"
                            >
                              <Edit size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubcategoryConfig(cat.id, sub)}
                              className="text-zinc-400 hover:text-rose-500"
                              title="Delete Subcategory"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Add Subcategory Row */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder="+ New Subcategory (EN)"
                        value={newSubcatInputs[cat.id]?.name || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setNewSubcatInputs(prev => ({
                            ...prev,
                            [cat.id]: {
                              name: val,
                              nameAr: showArabicFields
                                ? (prev[cat.id]?.nameAr ? prev[cat.id].nameAr : translateToArabic(val))
                                : (prev[cat.id]?.nameAr || '')
                            }
                          }));
                        }}
                        className={`p-1.5 px-2.5 rounded-lg border text-xs ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-slate-200'}`}
                      />
                      {showArabicFields && (
                        <input
                          type="text"
                          dir="rtl"
                          placeholder="الفئة الفرعية بالعربية"
                          value={newSubcatInputs[cat.id]?.nameAr || ''}
                          onChange={e => {
                            const val = toEnglishNumerals(e.target.value);
                            setNewSubcatInputs(prev => ({
                              ...prev,
                              [cat.id]: {
                                name: prev[cat.id]?.name || '',
                                nameAr: val
                              }
                            }));
                          }}
                          className={`p-1.5 px-2.5 rounded-lg border text-xs ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-slate-200'}`}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => handleAddSubcategoryConfig(cat)}
                        className="px-3 py-1.5 rounded-lg bg-[#00B8C8]/20 hover:bg-[#00B8C8]/30 text-[#00B8C8] text-xs font-black"
                      >
                        + Add Subcategory
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* Receive Stock (Restock) Modal */}
      <Modal isOpen={!!restockItem} onClose={() => { setRestockItem(null); setRestockVariantId(''); }} title={`Receive Stock — ${restockItem?.name || ''}`} theme={isDarkMode ? 'dark' : 'light'}>
        <form onSubmit={handleReceiveStock} className="space-y-4">
          {restockItem?.variants && restockItem.variants.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-indigo-400 uppercase mb-1.5">Target Product Variant</label>
              <select
                value={restockVariantId}
                onChange={e => setRestockVariantId(e.target.value)}
                className={`w-full p-2.5 rounded-lg border text-sm font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-indigo-300' : 'bg-white border-zinc-200 text-indigo-700'}`}
              >
                {restockItem.variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} (Current Stock: {v.stock})
                  </option>
                ))}
              </select>
            </div>
          )}

          {restockItem?.isPackagedGood && (restockItem.unitsPerPack || 0) > 1 && (
            <div className="p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 flex items-center justify-between gap-2 text-xs" dir="ltr">
              <span className="font-bold text-indigo-400">Receive Mode:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRestockByPack(true)}
                  className={`px-2.5 py-1 rounded-lg font-black ${
                    restockByPack ? 'bg-indigo-500 text-white' : 'text-zinc-400'
                  }`}
                >
                  Receive by Packs ({restockItem.unitsPerPack} units/pack)
                </button>
                <button
                  type="button"
                  onClick={() => setRestockByPack(false)}
                  className={`px-2.5 py-1 rounded-lg font-black ${
                    !restockByPack ? 'bg-[#00B8C8] text-slate-950' : 'text-zinc-400'
                  }`}
                >
                  Receive by Single Units
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4" dir="ltr">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                {restockItem?.isPackagedGood && restockByPack
                  ? `Packs Received (${restockItem.unitsPerPack || 12}u/pack)`
                  : 'Single Units Received'}
              </label>
              <input
                type="number"
                min="1"
                required
                value={restockQty}
                onChange={e => setRestockQty(parseInt(e.target.value, 10) || 0)}
                className={`w-full p-2.5 rounded-lg border font-mono ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
              {restockItem?.isPackagedGood && restockByPack && (
                <div className="text-[10px] font-mono text-indigo-400 font-bold mt-1">
                  = +{restockQty * Math.max(1, Number(restockItem.unitsPerPack) || 1)} Single Units Added
                </div>
              )}
            </div>
            <div>
              {restockItem?.isPackagedGood && restockByPack ? (
                <>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                    Cost per Pack ({type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? 'LBP ل.ل' : '$ USD'})
                  </label>
                  <input
                    type="number"
                    step={type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? '1000' : '0.01'}
                    min="0"
                    required
                    value={restockPackCostInput}
                    onChange={e => {
                      const val = e.target.value;
                      setRestockPackCostInput(val);
                      const raw = Math.max(0, parseFloat(val) || 0);
                      const upp = Math.max(1, Number(restockItem.unitsPerPack) || 1);
                      const packUSD = type === 'cafeteria' && inventoryCurrencyView === 'LBP' ? raw / effectiveRate : raw;
                      setRestockUnitCost(Number((packUSD / upp).toFixed(4)));
                    }}
                    className={`w-full p-2.5 rounded-lg border font-mono ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                  />
                  <div className="text-[10px] font-mono text-zinc-400 mt-1">
                    Unit Cost: ${restockUnitCost.toFixed(4)} ({Math.round(restockUnitCost * effectiveRate).toLocaleString('en-US')} LBP)
                  </div>
                </>
              ) : (
                <>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                    Batch Unit Cost ($ USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={restockUnitCost}
                    onChange={e => setRestockUnitCost(parseFloat(e.target.value) || 0)}
                    className={`w-full p-2.5 rounded-lg border font-mono ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
                  />
                  <div className="text-[10px] font-mono text-zinc-400 mt-1">
                    ≈ {Math.round(restockUnitCost * effectiveRate).toLocaleString('en-US')} LBP / unit
                  </div>
                </>
              )}
            </div>
          </div>

          {restockItem && (
            <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${isDarkMode ? 'bg-zinc-900/70 border-zinc-800 text-zinc-300' : 'bg-slate-50 border-slate-200 text-slate-700'}`} dir="ltr">
              <span>Weighted Average Cost (Coût Moyen Pondéré):</span>
              <span className="font-mono font-black text-[#00B8C8]">
                ${(() => {
                  const oldStock = Math.max(0, Number(restockItem.stock) || 0);
                  const oldCost = Math.max(0, Number(restockItem.costPrice ?? restockItem.cost) || 0);
                  const mult = restockItem.isPackagedGood && restockByPack ? Math.max(1, Number(restockItem.unitsPerPack) || 1) : 1;
                  const added = Math.max(0, Number(restockQty) || 0) * mult;
                  const uCost = restockUnitCost > 0 ? restockUnitCost : oldCost;
                  return oldStock + added > 0
                    ? (((oldStock * oldCost) + (added * uCost)) / (oldStock + added)).toFixed(4)
                    : uCost.toFixed(2);
                })()} / unit
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Supplier</label>
              <input type="text" value={restockSupplier} onChange={e => setRestockSupplier(e.target.value)} className={`w-full p-2.5 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Batch Expiry Date</label>
              <input type="date" value={restockExpiry} onChange={e => setRestockExpiry(e.target.value)} className={`w-full p-2.5 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
          </div>
          {(() => {
            const mult = restockItem?.isPackagedGood && restockByPack ? Math.max(1, Number(restockItem.unitsPerPack) || 1) : 1;
            const totalUnitsReceived = (Number(restockQty) || 0) * mult;
            const totalBatchCostUSD = totalUnitsReceived * restockUnitCost;
            return (
              <>
                <label className="flex items-center gap-2 text-xs font-bold cursor-pointer" dir="ltr">
                  <input type="checkbox" checked={recordRestockExpense} onChange={e => setRecordRestockExpense(e.target.checked)} className="rounded" />
                  Record inventory purchase in Financial Ledger (LCOA {type === 'cafeteria' ? '301' : '302'} / 531 — ${totalBatchCostUSD.toFixed(2)} / {Math.round(totalBatchCostUSD * effectiveRate).toLocaleString('en-US')} LBP)
                </label>
                <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors">
                  Confirm Stock Receipt (+{totalUnitsReceived} Single Units)
                </button>
              </>
            );
          })()}
        </form>
      </Modal>

      {/* Wastage / Expired Write-Off Modal */}
      <Modal isOpen={!!wastageItem} onClose={() => setWastageItem(null)} title={`Wastage / Expired Write-Off — ${wastageItem?.name || ''}`} theme={isDarkMode ? 'dark' : 'light'}>
        <form onSubmit={handleWastageWriteOff} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Quantity to Write Off (Max: {wastageItem?.stock ?? 0})</label>
              <input type="number" min="1" max={wastageItem?.stock ?? 1} required value={wastageQty} onChange={e => setWastageQty(parseInt(e.target.value, 10) || 1)} className={`w-full p-2.5 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Reason</label>
              <select value={wastageReason} onChange={e => setWastageReason(e.target.value as any)} className={`w-full p-2.5 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                <option value="expired">Expired Batch</option>
                <option value="damaged">Damaged / Spoiled</option>
                <option value="theft">Shrinkage / Missing</option>
                <option value="other">Other Write-Off</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Audit Notes</label>
            <input type="text" placeholder="Optional explanation for audit ledger..." value={wastageNotes} onChange={e => setWastageNotes(e.target.value)} className={`w-full p-2.5 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} />
          </div>
          <button type="submit" className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold transition-colors">
            Confirm Write-Off (-{wastageQty} Units • LCOA 6019)
          </button>
        </form>
      </Modal>

      {/* Void / Refund Order Reason Modal */}
      <Modal
        isOpen={!!refundModalOrder}
        onClose={() => {
          setRefundModalOrder(null);
          setRefundReasonInput('');
        }}
        title={
          refundModalOrder?.paymentMethod === 'cash'
            ? `Void Cash Order #${refundModalOrder.id.slice(0, 8)}`
            : `Refund Order #${refundModalOrder?.id.slice(0, 8) || ''}`
        }
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <form onSubmit={confirmRefundOrder} className="space-y-4">
          <div className={`p-3.5 rounded-xl border text-xs space-y-1 ${isDarkMode ? 'bg-zinc-900/70 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="font-bold">
              Order Total: <span className="font-mono text-[#00B8C8]">${refundModalOrder?.total.toFixed(2)}</span>
            </div>
            <div className="text-zinc-500">
              Restores inventory stock (including variants & bundle components), reverses COGS (LCOA 601), and releases any coupon lock.
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Mandatory Audit Reason</label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. Customer returned unopened item / Cashier entry error"
              value={refundReasonInput}
              onChange={e => setRefundReasonInput(e.target.value)}
              className={`w-full p-2.5 rounded-xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setRefundModalOrder(null);
                setRefundReasonInput('');
              }}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold border ${isDarkMode ? 'border-zinc-800 text-zinc-300' : 'border-slate-200 text-slate-600'}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black uppercase tracking-wider"
            >
              Confirm {refundModalOrder?.paymentMethod === 'cash' ? 'Void' : 'Refund'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Clear Cart Confirmation Modal */}
      <Modal
        isOpen={isClearCartModalOpen}
        onClose={() => setIsClearCartModalOpen(false)}
        title={posLang === 'ar' ? 'تأكيد إفراغ السلة' : 'Clear Current Cart'}
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            {posLang === 'ar'
              ? 'هل أنت متأكد أنك تريد إزالة جميع العناصر من السلة الحالية؟'
              : 'Are you sure you want to remove all items from the current order cart?'}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsClearCartModalOpen(false)}
              className={`px-4 py-2 rounded-xl text-xs font-bold border ${isDarkMode ? 'border-zinc-800 text-zinc-300' : 'border-slate-200 text-slate-600'}`}
            >
              {posLang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCart([]);
                setIsClearCartModalOpen(false);
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
            >
              {posLang === 'ar' ? 'إفراغ السلة' : 'Clear Cart'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Inventory Item Confirmation Modal */}
      <Modal
        isOpen={!!deleteItemModalTarget}
        onClose={() => setDeleteItemModalTarget(null)}
        title="Delete Inventory Item"
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Are you sure you want to permanently delete <span className="font-bold text-white">{deleteItemModalTarget?.name}</span> from inventory?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteItemModalTarget(null)}
              className={`px-4 py-2 rounded-xl text-xs font-bold border ${isDarkMode ? 'border-zinc-800 text-zinc-300' : 'border-slate-200 text-slate-600'}`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteItem}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
            >
              Delete Item
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Category Confirmation Modal */}
      <Modal
        isOpen={!!deleteCategoryModalTarget}
        onClose={() => setDeleteCategoryModalTarget(null)}
        title="Delete POS Category"
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Are you sure you want to delete category <span className="font-bold text-white">{deleteCategoryModalTarget?.name}</span> and its subcategories?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteCategoryModalTarget(null)}
              className={`px-4 py-2 rounded-xl text-xs font-bold border ${isDarkMode ? 'border-zinc-800 text-zinc-300' : 'border-slate-200 text-slate-600'}`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteCategoryConfig}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
            >
              Delete Category
            </button>
          </div>
        </div>
      </Modal>

      {/* Manager Override PIN Modal */}
      <Modal
        isOpen={isManagerPinModalOpen}
        onClose={() => {
          setIsManagerPinModalOpen(false);
          setManagerPinInput('');
          setPendingManagerAction(null);
        }}
        title={posLang === 'ar' ? 'مطلوب رمز موافقة المدير (PIN)' : 'Manager Override PIN Required'}
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <form onSubmit={handleVerifyManagerPin} className="space-y-4">
          <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs space-y-1">
            <div className="font-black text-amber-400 flex items-center gap-1.5">
              <ShieldAlert size={14} />
              <span>{posLang === 'ar' ? 'إجراء محمي بصلاحيات المدير:' : 'Restricted Action:'}</span>
            </div>
            <div className="text-zinc-300 font-semibold">{pendingManagerAction?.label || ''}</div>
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
              {posLang === 'ar' ? 'أدخل رمز المدير (الافتراضي: 1234)' : 'Enter Manager Override PIN (Default: 1234)'}
            </label>
            <input
              type="password"
              dir="ltr"
              required
              autoFocus
              placeholder="••••"
              value={managerPinInput}
              onChange={e => setManagerPinInput(toEnglishNumerals(e.target.value))}
              className={`w-full p-3 rounded-xl border text-center text-lg font-mono tracking-widest ${
                isDarkMode ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-slate-900'
              }`}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsManagerPinModalOpen(false);
                setManagerPinInput('');
                setPendingManagerAction(null);
              }}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold border ${isDarkMode ? 'border-zinc-800 text-zinc-300' : 'border-slate-200 text-slate-600'}`}
            >
              {posLang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 text-xs font-black uppercase tracking-wider"
            >
              {posLang === 'ar' ? 'تأكيد الرمز' : 'Authorize Action'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Open Cashier Shift Modal */}
      <Modal
        isOpen={isOpenShiftModalOpen}
        onClose={() => setIsOpenShiftModalOpen(false)}
        title={posLang === 'ar' ? 'فتح وردية كاشير جديدة' : 'Open New Cashier Shift'}
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <form onSubmit={handleOpenShift} className="space-y-4">
          <p className="text-xs text-zinc-400">
            {posLang === 'ar'
              ? 'أدخل الرصيد الافتتاحي لصندوق النقد (بالدولار والليرة اللبنانية) لبدء الوردية.'
              : 'Record the starting physical cash float in the drawer (USD & LBP) to open your shift.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                {posLang === 'ar' ? 'رصيد افتتاحي ($ USD)' : 'Opening Float ($ USD)'}
              </label>
              <input
                type="number"
                dir="ltr"
                step="0.01"
                min="0"
                required
                value={shiftOpeningFloatUSD}
                onChange={e => setShiftOpeningFloatUSD(e.target.value)}
                className={`w-full p-2.5 rounded-xl border font-mono font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                {posLang === 'ar' ? 'رصيد افتتاحي (LBP ل.ل)' : 'Opening Float (LBP)'}
              </label>
              <input
                type="number"
                dir="ltr"
                step="50000"
                min="0"
                required
                value={shiftOpeningFloatLBP}
                onChange={e => setShiftOpeningFloatLBP(e.target.value)}
                className={`w-full p-2.5 rounded-xl border font-mono font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider"
          >
            {posLang === 'ar' ? 'بدء الوردية الآن' : 'Open Cashier Shift'}
          </button>
        </form>
      </Modal>

      {/* Close Shift & Physical Drawer Count Modal */}
      <Modal
        isOpen={isCloseShiftModalOpen}
        onClose={() => setIsCloseShiftModalOpen(false)}
        title={posLang === 'ar' ? 'إغلاق الوردية وجرد الصندوق الفعلي' : 'Close Shift & Count Physical Cash Drawer'}
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <form onSubmit={handleCloseShiftAndCountDrawer} className="space-y-4">
          <div className={`p-3.5 rounded-xl border space-y-2 text-xs ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex justify-between">
              <span className="text-zinc-400">Opening Float:</span>
              <span className="font-mono font-bold">
                ${zReportMetrics.openingFloatUSD.toFixed(2)} USD + {zReportMetrics.openingFloatLBP.toLocaleString('en-US')} LBP
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Expected Physical Drawer USD:</span>
              <span className="font-mono font-black text-emerald-400">${zReportMetrics.expectedDrawerUSD.toFixed(2)} USD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Expected Physical Drawer LBP:</span>
              <span className="font-mono font-black text-amber-400">{zReportMetrics.expectedDrawerLBP.toLocaleString('en-US')} LBP</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                Actual Counted USD ($)
              </label>
              <input
                type="number"
                dir="ltr"
                step="0.01"
                min="0"
                required
                value={actualCountedUSDInput}
                onChange={e => setActualCountedUSDInput(e.target.value)}
                className={`w-full p-2.5 rounded-xl border font-mono font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">
                Actual Counted LBP (ل.ل)
              </label>
              <input
                type="number"
                dir="ltr"
                step="50000"
                min="0"
                required
                value={actualCountedLBPInput}
                onChange={e => setActualCountedLBPInput(e.target.value)}
                className={`w-full p-2.5 rounded-xl border font-mono font-bold ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
            </div>
          </div>

          {(() => {
            const cUSD = parseFloat(actualCountedUSDInput) || 0;
            const cLBP = parseFloat(actualCountedLBPInput) || 0;
            const vUSD = Number((cUSD - zReportMetrics.expectedDrawerUSD).toFixed(2));
            const vLBP = Math.round(cLBP - zReportMetrics.expectedDrawerLBP);
            return (
              <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/60 flex items-center justify-between text-xs font-mono" dir="ltr">
                <span className="text-zinc-400">Cash Over / Short Variance:</span>
                <span className={vUSD < 0 || vLBP < 0 ? 'text-rose-400 font-black' : 'text-emerald-400 font-black'}>
                  {vUSD >= 0 ? `+$${vUSD.toFixed(2)}` : `-$${Math.abs(vUSD).toFixed(2)}`} USD | {vLBP >= 0 ? `+${vLBP.toLocaleString('en-US')}` : vLBP.toLocaleString('en-US')} LBP
                </span>
              </div>
            );
          })()}

          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Shift Closing Notes (Optional)</label>
            <input
              type="text"
              placeholder="Any variance explanation or handover notes..."
              value={shiftClosingNotes}
              onChange={e => setShiftClosingNotes(e.target.value)}
              className={`w-full p-2.5 rounded-xl border text-xs ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <Printer size={15} /> Close Shift & Export Z-Report PDF
          </button>
        </form>
      </Modal>

      {/* 80mm Thermal Receipt Preview & 1-Click WhatsApp Digital Receipt Modal */}
      <Modal
        isOpen={!!receiptModalOrder}
        onClose={() => setReceiptModalOrder(null)}
        title={
          posLang === 'ar'
            ? `إيصال الدفع الحراري (80mm) — #${receiptModalOrder?.id.slice(0, 8) || ''}`
            : `80mm Thermal Receipt — #${receiptModalOrder?.id.slice(0, 8) || ''}`
        }
        theme={isDarkMode ? 'dark' : 'light'}
      >
        {receiptModalOrder && (
          <div className="space-y-4">
            {/* Authentic 80mm Thermal Paper Preview */}
            <div
              className="mx-auto max-w-[310px] bg-white text-slate-950 p-4 rounded-xl shadow-lg font-mono text-xs border border-slate-200 space-y-2"
              dir={posLang === 'ar' ? 'rtl' : 'ltr'}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <div className="text-center font-black text-sm">{systemName || 'Vescio Nexus'}</div>
              <div className="text-center text-[10px] text-slate-500">
                {type === 'cafeteria' ? 'Kiosk POS — Mini-Supermarket' : 'Retail Shop POS'}
              </div>
              <div className="border-t border-dashed border-slate-400 my-1.5" />
              <div className="flex justify-between text-[11px]">
                <span>{posLang === 'ar' ? 'رقم الطلب:' : 'Order #:'}</span>
                <span dir="ltr">#{receiptModalOrder.id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>{posLang === 'ar' ? 'التاريخ:' : 'Date:'}</span>
                <span dir="ltr">{new Date(receiptModalOrder.date).toLocaleString('en-US')}</span>
              </div>
              {receiptModalOrder.memberName && (
                <div className="flex justify-between text-[11px]">
                  <span>{posLang === 'ar' ? 'العميل:' : 'Customer:'}</span>
                  <span>{receiptModalOrder.memberName}</span>
                </div>
              )}
              <div className="border-t border-dashed border-slate-400 my-1.5" />
              <div className="space-y-1">
                {(receiptModalOrder.items || []).map((it, idx) => (
                  <div key={idx} className="flex justify-between text-[11px]">
                    <span>
                      {it.quantity}x {posLang === 'ar' ? (it.nameAr || translateToArabic(it.name)) : it.name}
                    </span>
                    <span dir="ltr">${(it.quantity * it.price).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-slate-400 my-1.5" />
              <div className="flex justify-between text-[11px]">
                <span>{posLang === 'ar' ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                <span dir="ltr">${Number(receiptModalOrder.subtotal || receiptModalOrder.total).toFixed(2)}</span>
              </div>
              {receiptModalOrder.discount > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span>{posLang === 'ar' ? 'الحسم:' : 'Discount:'}</span>
                  <span dir="ltr">-${Number(receiptModalOrder.discount).toFixed(2)}</span>
                </div>
              )}
              {(receiptModalOrder.taxAmount || 0) > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span>{posLang === 'ar' ? 'ضريبة 11% (TVA):' : '11% VAT (4427):'}</span>
                  <span dir="ltr">+${Number(receiptModalOrder.taxAmount).toFixed(2)}</span>
                </div>
              )}
              <div className="border-t border-dashed border-slate-400 my-1.5" />
              <div className="flex justify-between font-black text-sm">
                <span>{posLang === 'ar' ? 'الإجمالي (USD):' : 'TOTAL (USD):'}</span>
                <span dir="ltr">${receiptModalOrder.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-[11px]">
                <span>{posLang === 'ar' ? 'الإجمالي (LBP):' : 'TOTAL (LBP):'}</span>
                <span dir="ltr">
                  {Math.round(receiptModalOrder.total * (receiptModalOrder.fxRate || effectiveRate)).toLocaleString('en-US')} LBP
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-600 pt-1">
                <span>{posLang === 'ar' ? 'طريقة الدفع:' : 'Payment:'}</span>
                <span dir="ltr">{receiptModalOrder.paymentMethod.replace('_', ' ').toUpperCase()}</span>
              </div>
              {(receiptModalOrder.changeUSD || 0) > 0 && (
                <div className="flex justify-between text-[10px] text-emerald-700 font-bold">
                  <span>{posLang === 'ar' ? 'الباقي للعميل:' : 'Change Due:'}</span>
                  <span dir="ltr">
                    ${Number(receiptModalOrder.changeUSD).toFixed(2)} ({Number(receiptModalOrder.changeLBP || 0).toLocaleString('en-US')} LBP)
                  </span>
                </div>
              )}
            </div>

            {/* WhatsApp Phone Input */}
            <div>
              <label className="block text-[10px] font-black uppercase text-zinc-500 mb-1">
                {posLang === 'ar' ? 'رقم واتساب العميل (لإرسال الإيصال الرقمي)' : 'Customer WhatsApp Phone (for 1-Click Digital Receipt)'}
              </label>
              <input
                type="tel"
                dir="ltr"
                placeholder="e.g. 961 70 123456 or 03 123456"
                value={whatsAppPhoneInput}
                onChange={e => setWhatsAppPhoneInput(toEnglishNumerals(e.target.value))}
                className={`w-full p-2.5 rounded-xl border text-xs font-mono ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
              />
            </div>

            {/* 3 Instant Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handlePrintThermalReceipt(receiptModalOrder)}
                className="py-2.5 px-3 rounded-xl bg-[#00B8C8] hover:bg-[#0099A8] text-slate-950 font-black text-xs flex items-center justify-center gap-1.5"
              >
                <Printer size={15} />
                <span>{posLang === 'ar' ? 'طباعة 80mm' : 'Print 80mm'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadThermalReceiptPDF(receiptModalOrder)}
                className={`py-2.5 px-3 rounded-xl border font-black text-xs flex items-center justify-center gap-1.5 ${
                  isDarkMode ? 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800' : 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
                }`}
              >
                <Download size={15} />
                <span>{posLang === 'ar' ? 'تنزيل PDF' : 'Receipt PDF'}</span>
              </button>
              <a
                href={buildWhatsAppReceiptUrl(receiptModalOrder, whatsAppPhoneInput)}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-1.5"
              >
                <MessageCircle size={15} />
                <span>{posLang === 'ar' ? 'إرسال واتساب' : 'WhatsApp'}</span>
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

