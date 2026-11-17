import React, { useState, useEffect } from 'react';

interface WeeklyCalendarProps {
  activeCourt: string;
  bookings: any[];
  offDays: string[];
  onBookingClick: (booking: any) => void;
  onTimeSelected: (day: string, startTime: string, endTime: string, type: string, fullDate: string) => void;
  theme: 'dark' | 'light';
  allowPastDatesOverride?: boolean;
  onTogglePastDatesOverride?: (allow: boolean) => void;
}

const times: string[] = [];
for (let h = 7; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    times.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }
}
for (let h = 0; h < 2; h++) {
  for (let m = 0; m < 60; m += 15) {
    times.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }
}

const getNextTimeSlot = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  const date = new Date(2000, 0, 1, h, m + 15);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

export const WeeklyCalendar: React.FC<WeeklyCalendarProps> = ({ activeCourt, bookings, offDays, onBookingClick, onTimeSelected, theme, allowPastDatesOverride = false, onTogglePastDatesOverride }) => {
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(now.setDate(diff));
  });

  const [currentDay, setCurrentDay] = useState(() => new Date());

  const todayStr = new Date().toISOString().split('T')[0];

  const days = viewMode === 'week' 
    ? Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(currentWeekStart);
        d.setDate(currentWeekStart.getDate() + i);
        const fullDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return {
          name: d.toLocaleDateString('en-US', { weekday: 'short' }),
          date: String(d.getDate()),
          fullDate,
          isPast: (!allowPastDatesOverride && fullDate < todayStr) || offDays.includes(fullDate)
        };
      })
    : (() => {
        const d = currentDay;
        const fullDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return [{
          name: d.toLocaleDateString('en-US', { weekday: 'short' }),
          date: String(d.getDate()),
          fullDate,
          isPast: (!allowPastDatesOverride && fullDate < todayStr) || offDays.includes(fullDate)
        }];
      })();

  const handlePrev = () => {
    if (viewMode === 'week') {
      const newDate = new Date(currentWeekStart);
      newDate.setDate(currentWeekStart.getDate() - 7);
      setCurrentWeekStart(newDate);
    } else {
      const newDate = new Date(currentDay);
      newDate.setDate(currentDay.getDate() - 1);
      setCurrentDay(newDate);
    }
  };

  const handleNext = () => {
    if (viewMode === 'week') {
      const newDate = new Date(currentWeekStart);
      newDate.setDate(currentWeekStart.getDate() + 7);
      setCurrentWeekStart(newDate);
    } else {
      const newDate = new Date(currentDay);
      newDate.setDate(currentDay.getDate() + 1);
      setCurrentDay(newDate);
    }
  };

  const handleToday = () => {
    const now = new Date();
    if (viewMode === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      setCurrentWeekStart(new Date(now.setDate(diff)));
    } else {
      setCurrentDay(now);
    }
  };

  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    day: string;
    startType: string;
    currentType: string;
    startIndex: number;
    endIndex: number;
  } | null>(null);

  const getCourtColor = () => {
    if (activeCourt === 'padel1' || activeCourt === 'padel2') return 'bg-emerald-500 hover:bg-emerald-600';
    if (activeCourt === 'tennis') return 'bg-purple-500 hover:bg-purple-600';
    return 'bg-blue-600 hover:bg-blue-700';
  };

  const getBookingColor = (type: string, status?: string, category?: string) => {
    if (status === 'cashed_in') {
      return theme === 'dark' 
        ? 'bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-400 border border-zinc-700/50'
        : 'bg-zinc-100 text-zinc-400 border border-zinc-200';
    }

    if (category === 'hustle') {
      return 'bg-amber-600/95 hover:bg-amber-500 text-white border border-amber-400/30';
    }
    if (category === 'academy') {
      return 'bg-indigo-600/95 hover:bg-indigo-500 text-white border border-indigo-400/30';
    }
    if (category === 'private') {
      return 'bg-cyan-600/95 hover:bg-cyan-500 text-white border border-cyan-400/30';
    }
    
    if (activeCourt === 'basketball') {
      if (type === 'HCA') return 'bg-orange-500/90 hover:bg-orange-500 text-white';
      if (type === 'HCB') return 'bg-blue-500/90 hover:bg-blue-500 text-white';
      return 'bg-red-500/90 hover:bg-red-500 text-white';
    }
    if (activeCourt === 'padel1' || activeCourt === 'padel2') return 'bg-emerald-500 hover:bg-emerald-600 text-white';
    if (activeCourt === 'tennis') return 'bg-purple-500 hover:bg-purple-600 text-white';
    return 'bg-blue-600 hover:bg-blue-700 text-white';
  };

  const timeToIndex = (time: string) => times.indexOf(time);
  const groupedBookings: any[] = [];
  const processed = new Set();

  const currentWeekDates = days.map(d => d.fullDate);

  
  const visibleBookings = bookings.filter(b => {
    if (b.date) {
      return currentWeekDates.includes(b.date);
    }
    return true; // Legacy bookings without date show up on their respective day
  });

   visibleBookings.forEach(b => {
    const key = b.groupId ? `${b.groupId}-${b.date || b.day}-${b.time}` : `${b.day}-${b.time}-${b.name}-${b.type}-${b.date || ''}`;
    if (processed.has(key)) return;
    
    let startIndex = timeToIndex(b.time);
    if (startIndex === -1) return;

    let currentIndex = startIndex;
    let span = 1;
    processed.add(key);

    while (true) {
      const nextTime = times[currentIndex + 1];
      if (!nextTime) break;
      const nextKey = b.groupId ? `${b.groupId}-${b.date || b.day}-${nextTime}` : `${b.day}-${nextTime}-${b.name}-${b.type}-${b.date || ''}`;
      const hasNext = visibleBookings.some(bk => {
        if (b.groupId && bk.groupId) {
          return bk.groupId === b.groupId && (bk.date || bk.day) === (b.date || b.day) && bk.time === nextTime;
        }
        return `${bk.day}-${bk.time}-${bk.name}-${bk.type}-${bk.date || ''}` === nextKey;
      });
      
      if (hasNext) {
        processed.add(nextKey);
        span++;
        currentIndex++;
      } else {
        break;
      }
    }

    groupedBookings.push({
      ...b,
      startIndex,
      span
    });
  });

  const handleMouseDown = (day: string, timeIndex: number, type: string) => {
    setDragState({
      isDragging: true,
      day,
      startType: type,
      currentType: type,
      startIndex: timeIndex,
      endIndex: timeIndex
    });
  };

  const handleMouseMove = (day: string, timeIndex: number, type: string, _e: React.MouseEvent) => {
    if (dragState && dragState.isDragging) {
      if (dragState.day === day) {
        const targetIndex = timeIndex;
        const newType = type === dragState.startType ? dragState.startType : 'full';

        if (targetIndex !== dragState.endIndex || newType !== dragState.currentType) {
          setDragState({ 
            ...dragState, 
            endIndex: targetIndex,
            currentType: newType
          });
        }
      }
    }
  };

  const handleMouseUp = () => {
    if (dragState && dragState.isDragging) {
      const start = Math.min(dragState.startIndex, dragState.endIndex);
      const end = Math.max(dragState.startIndex, dragState.endIndex);
      
      const startTime = times[start];
      // If user clicked a single row without dragging across rows, default to 15-min slot (getNextTimeSlot).
      // If user dragged from e.g. 19:00 down to the 20:30 row, the target row time (20:30) IS the exact endTime.
      const endTime = start === end ? getNextTimeSlot(times[start]) : times[end];
      
      const dayObj = days.find(d => d.name === dragState.day);
      const fullDate = dayObj ? dayObj.fullDate : '';

      onTimeSelected(dragState.day, startTime, endTime, dragState.currentType, fullDate);
      setDragState(null);
    }
  };

  useEffect(() => {
    const handleWindowMouseUp = () => handleMouseUp();
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [dragState]);

  return (
    <div className="px-8 py-2 pb-12">
      <div className="flex items-center justify-between mb-5">
        <div className="flex-1"></div>
        
        <div className="flex items-center gap-4">
          <button onClick={handlePrev} className={`p-1.5 rounded-lg transition-all ${
            theme === 'dark' ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}>&lt;</button>
          
          <h2 className={`text-base font-medium tracking-tight transition-colors min-w-[140px] text-center ${
            theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'
          }`}>
            {viewMode === 'week' 
              ? currentWeekStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              : currentDay.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            }
          </h2>

          <button onClick={handleNext} className={`p-1.5 rounded-lg transition-all ${
            theme === 'dark' ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}>&gt;</button>
        </div>
        
        <div className="flex-1 flex items-center justify-end gap-4">
          <label className={`flex items-center gap-2 text-sm cursor-pointer ${theme === 'dark' ? 'text-zinc-400 hover:text-zinc-300' : 'text-zinc-600 hover:text-zinc-800'}`}>
            <input 
              type="checkbox" 
              checked={allowPastDatesOverride}
              onChange={(e) => onTogglePastDatesOverride?.(e.target.checked)}
              className={`rounded border transition-colors ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700 text-blue-500 focus:ring-blue-500/50' : 'bg-white border-zinc-300 text-blue-600 focus:ring-blue-500/30'}`}
            />
            Allow Past Dates
          </label>
          <button onClick={handleToday} className={`text-sm font-medium px-3 transition-colors ${
            theme === 'dark' ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900'
          }`}>Today</button>

          <div className={`flex p-1 rounded-lg border transition-colors ${
            theme === 'dark' ? 'bg-[#0B0F17] border-zinc-800' : 'bg-zinc-100 border-zinc-200'
          }`}>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                viewMode === 'week' 
                  ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                viewMode === 'day' 
                  ? 'bg-[#00B8C8] text-slate-950 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Day
            </button>
          </div>
        </div>
      </div>
      <div 
        className={`grid gap-[1px] border rounded-xl overflow-hidden shadow-2xl select-none relative transition-colors ${
          theme === 'dark' ? 'bg-zinc-800/50 border-zinc-800/80 shadow-black/20' : 'bg-zinc-200 border-zinc-200 shadow-zinc-200/50'
        }`}
        style={{ 
          gridTemplateColumns: activeCourt === 'basketball' 
            ? `60px repeat(${days.length * 2}, 1fr)` 
            : `60px repeat(${days.length}, 1fr)`,
          gridTemplateRows: `auto repeat(${times.length}, minmax(30px, 1fr))`
        }}
        onMouseLeave={handleMouseUp}
      >
        <div className={`p-3 backdrop-blur-sm sticky top-0 z-20 transition-colors ${
          theme === 'dark' ? 'bg-[#05070A]/90' : 'bg-white/90'
        }`} style={{ gridColumn: 1, gridRow: 1 }}></div>
        
        {days.map((day, i) => (
          <div 
            key={day.name} 
            className={`p-2.5 text-center backdrop-blur-sm flex flex-col justify-center sticky top-0 z-20 transition-colors ${
              theme === 'dark' ? 'bg-[#05070A]/90' : 'bg-white/90'
            } ${day.isPast ? 'opacity-40' : ''}`}
            style={{ gridColumn: activeCourt === 'basketball' ? `${i * 2 + 2} / span 2` : i + 2, gridRow: 1 }}
          >
            <div className="text-[8px] font-semibold text-zinc-500 uppercase tracking-widest mb-0.5">{day.name}</div>
            <div className={`text-base font-medium transition-colors ${
              theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'
            }`}>{day.date}</div>
          </div>
        ))}

        {times.map((time, i) => (
          <div 
            key={time} 
            className={`p-2 text-[10px] font-medium text-zinc-500 text-right flex items-start justify-end pr-3 transition-colors ${
              theme === 'dark' ? 'bg-[#05070A]/90' : 'bg-white/90'
            }`}
            style={{ gridColumn: 1, gridRow: i + 2 }}
          >
            {time}
          </div>
        ))}

        {times.map((time, timeIndex) => (
          days.map((day, dayIndex) => {
            if (activeCourt === 'basketball') {
               return (
                 <React.Fragment key={`${day.name}-${time}-bg`}>
                   <div 
                     className={`border-r transition-colors ${
                       day.isPast
                         ? (theme === 'dark' ? 'bg-zinc-900/20 opacity-40' : 'bg-zinc-100/50 opacity-40')
                         : (theme === 'dark' 
                            ? `bg-[#0B0F17]/70 border-zinc-800/30 ${!dragState?.isDragging ? 'hover:bg-[#101622]' : ''}` 
                            : `bg-white border-zinc-100 ${!dragState?.isDragging ? 'hover:bg-zinc-50' : ''}`)
                     }`}
                     style={{ gridColumn: dayIndex * 2 + 2, gridRow: timeIndex + 2 }}
                     onMouseDown={() => !day.isPast && handleMouseDown(day.name, timeIndex, 'HCA')}
                     onMouseMove={(e) => !day.isPast && handleMouseMove(day.name, timeIndex, 'HCA', e)}
                   />
                   <div 
                     className={`transition-colors ${
                       day.isPast
                         ? (theme === 'dark' ? 'bg-zinc-900/20 opacity-40' : 'bg-zinc-100/50 opacity-40')
                         : (theme === 'dark' 
                            ? `bg-[#0B0F17]/70 ${!dragState?.isDragging ? 'hover:bg-[#101622]' : ''}` 
                            : `bg-white ${!dragState?.isDragging ? 'hover:bg-zinc-50' : ''}`)
                     }`}
                     style={{ gridColumn: dayIndex * 2 + 3, gridRow: timeIndex + 2 }}
                     onMouseDown={() => !day.isPast && handleMouseDown(day.name, timeIndex, 'HCB')}
                     onMouseMove={(e) => !day.isPast && handleMouseMove(day.name, timeIndex, 'HCB', e)}
                   />
                 </React.Fragment>
               )
            } else {
               return (
                 <div 
                   key={`${day.name}-${time}-bg`}
                   className={`transition-colors ${
                     day.isPast
                       ? (theme === 'dark' ? 'bg-zinc-900/20 opacity-40' : 'bg-zinc-100/50 opacity-40')
                       : (theme === 'dark' 
                          ? `bg-[#0B0F17]/70 ${!dragState?.isDragging ? 'hover:bg-[#101622]' : ''}` 
                          : `bg-white ${!dragState?.isDragging ? 'hover:bg-zinc-50' : ''}`)
                   }`}
                   style={{ gridColumn: dayIndex + 2, gridRow: timeIndex + 2 }}
                   onMouseDown={() => !day.isPast && handleMouseDown(day.name, timeIndex, 'full')}
                   onMouseMove={(e) => !day.isPast && handleMouseMove(day.name, timeIndex, 'full', e)}
                 />
               )
            }
          })
        ))}

        {dragState && dragState.isDragging && (() => {
          const dayIndex = days.findIndex(d => d.name === dragState.day);
          let gridColumn = dayIndex + 2;
          let gridColumnSpan = 1;

          if (activeCourt === 'basketball') {
            gridColumn = dayIndex * 2 + 2;
            if (dragState.currentType === 'HCB') gridColumn += 1;
            if (dragState.currentType === 'full') gridColumnSpan = 2;
          }

          const startIdx = Math.min(dragState.startIndex, dragState.endIndex);
          const endIdx = Math.max(dragState.startIndex, dragState.endIndex);
          const span = startIdx === endIdx ? 1 : (endIdx - startIdx);
          const previewStart = times[startIdx];
          const previewEnd = startIdx === endIdx ? getNextTimeSlot(times[startIdx]) : times[endIdx];

          return (
            <div 
              className="bg-[#00B8C8]/40 border-2 border-[#00B8C8] rounded pointer-events-none z-10 shadow-lg shadow-cyan-500/20 flex items-center justify-center"
              style={{
                gridColumn: `${gridColumn} / span ${gridColumnSpan}`,
                gridRow: `${startIdx + 2} / span ${span}`
              }}
            >
              <span className="text-[10px] font-black text-white bg-slate-950/80 px-1.5 py-0.5 rounded shadow">
                {previewStart} – {previewEnd}
              </span>
            </div>
          );
        })()}

        {groupedBookings.map((b, i) => {
           const dayIndex = b.date ? days.findIndex(d => d.fullDate === b.date) : days.findIndex(d => d.name === b.day);
           if (dayIndex === -1) return null;

           let gridColumn = activeCourt === 'basketball' ? (dayIndex * 2 + 2) : (dayIndex + 2);
           let gridColumnSpan = 1;

           if (activeCourt === 'basketball') {
             if (b.type === 'full' || !b.type) {
               gridColumnSpan = 2;
             } else if (b.type === 'HCB') {
               gridColumn = dayIndex * 2 + 3;
             }
           }

           const catBadge =
             b.category === 'academy' ? 'ACAD' :
             b.category === 'private' ? 'PRIV' :
             b.category === 'hustle' ? 'HUSTLE' : '';

           return (
             <div
               key={`booking-${i}`}
               className={`m-[1px] rounded-md p-1.5 flex items-center justify-center gap-1 cursor-pointer shadow-sm z-10 ${getBookingColor(b.type, b.status, b.category)}`}
               style={{ 
                 gridColumn: `${gridColumn} / span ${gridColumnSpan}`, 
                 gridRow: `${b.startIndex + 2} / span ${b.span}`,
                 writingMode: b.span > 2 ? 'vertical-rl' : 'horizontal-tb',
                 textOrientation: 'mixed'
               }}
               onClick={() => onBookingClick(b)}
             >
               {catBadge && (
                 <span className="text-[8px] font-black uppercase px-1 py-0.5 rounded bg-black/25 text-white/90 tracking-wider shrink-0">
                   {catBadge}
                 </span>
               )}
               <span className={`text-xs font-medium tracking-wide text-center overflow-hidden text-ellipsis whitespace-nowrap ${b.status === 'cashed_in' ? 'text-zinc-400' : 'text-white'}`}>
                 {b.name}{activeCourt === 'basketball' && (b.type === 'HCA' || b.type === 'HCB') ? ` (${b.type})` : ''}
               </span>
             </div>
           )
        })}
      </div>
    </div>
  );
};
