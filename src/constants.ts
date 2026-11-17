export const CATEGORIES = [
  { id: 'reservations', name: 'Reservations' },
  { id: 'gym', name: 'Gym Memberships' },
  { id: 'physio', name: 'Physio & Recovery' },
  { id: 'academy', name: 'Academy Session' },
  { id: 'coupons', name: 'Coupons' },
  { id: 'cashback', name: 'Cashback Codes' },
];

const generateSlots = (start: number, end: number) => {
  const slots = [];
  for (let hour = start; hour < 24 + end; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const h = hour % 24;
      slots.push(`${h.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    }
  }
  return slots;
};

export const RESERVATION_TYPES = {
  basketball: {
    name: 'Basketball Court',
    subcategories: ['Full Court', 'HCA', 'HCB'],
    rate: 50, // per hour
    slots: generateSlots(6, 2),
  },
  padel: {
    name: 'Padel',
    subcategories: ['Padel 1', 'Padel 2'],
    rate: 30,
    slots: generateSlots(6, 2),
  },
  tennis: {
    name: 'Tennis',
    subcategories: [],
    rate: 40,
    slots: generateSlots(8, 0), // Tennis specific range: 08:00 to 00:00
  },
};

export const COUNTRIES = [
  { name: 'Lebanon', flag: '🇱🇧', code: 'LB' },
  { name: 'United States', flag: '🇺🇸', code: 'US' },
  { name: 'United Kingdom', flag: '🇬🇧', code: 'GB' },
  { name: 'France', flag: '🇫🇷', code: 'FR' },
  { name: 'Germany', flag: '🇩🇪', code: 'DE' },
  { name: 'Italy', flag: '🇮🇹', code: 'IT' },
  { name: 'Spain', flag: '🇪🇸', code: 'ES' },
  { name: 'Canada', flag: '🇨🇦', code: 'CA' },
  { name: 'Australia', flag: '🇦🇺', code: 'AU' },
  { name: 'Brazil', flag: '🇧🇷', code: 'BR' },
  { name: 'Japan', flag: '🇯🇵', code: 'JP' },
  { name: 'China', flag: '🇨🇳', code: 'CN' },
  { name: 'India', flag: '🇮🇳', code: 'IN' },
  { name: 'Russia', flag: '🇷🇺', code: 'RU' },
  { name: 'South Africa', flag: '🇿🇦', code: 'ZA' },
  { name: 'United Arab Emirates', flag: '🇦🇪', code: 'AE' },
  { name: 'Saudi Arabia', flag: '🇸🇦', code: 'SA' },
  { name: 'Jordan', flag: '🇯🇴', code: 'JO' },
  { name: 'Egypt', flag: '🇪🇬', code: 'EG' },
  { name: 'Turkey', flag: '🇹🇷', code: 'TR' },
  { name: 'Greece', flag: '🇬🇷', code: 'GR' },
  { name: 'Cyprus', flag: '🇨🇾', code: 'CY' },
  { name: 'Syria', flag: '🇸🇾', code: 'SY' },
  { name: 'Iraq', flag: '🇮🇶', code: 'IQ' },
  { name: 'Kuwait', flag: '🇰🇼', code: 'KW' },
  { name: 'Qatar', flag: '🇶🇦', code: 'QA' },
  { name: 'Oman', flag: '🇴🇲', code: 'OM' },
];
