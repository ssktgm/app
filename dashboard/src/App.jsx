import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, ScatterChart, Scatter, ZAxis, ReferenceLine, LabelList
} from 'recharts';
import { Upload, Database, TrendingUp, Activity, Save, Trash2, Filter, AlertCircle, Award, Search, Calendar, RefreshCw, LineChart as LineChartIcon, BarChart2 } from 'lucide-react';

// --- Default Data (Import from files) ---
import DEFAULT_BATTING_CSV_URL from './data/scorer_stats_raw_b.csv?url';
import DEFAULT_PITCHING_CSV_URL from './data/scorer_stats_raw_p.csv?url';

// --- Helper Functions ---

const parseCSV = (text) => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  
  let headerLine = lines[0];
  // Remove BOM (Byte Order Mark) if it exists at the beginning of the file
  if (headerLine.charCodeAt(0) === 0xFEFF) {
      headerLine = headerLine.substring(1);
  }
  const headers = headerLine.split(',').map(h => h.trim());
  const result = [];
  
  for (let i = 1; i < lines.length; i++) {
    const currentline = lines[i].split(',');
    if (currentline.length <= 1) continue;
    
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let val = currentline[j] ? currentline[j].trim() : '';
      if (!['選手ID', '名前', '日付', '試合ID', 'スコア', 'カテゴリ', '球場', 'タイトル', '背番号', '先攻', '後攻'].includes(headers[j])) {
         if (!isNaN(val) && val !== '') {
             val = Number(val);
         }
      }
      obj[headers[j]] = val;
    }
    result.push(obj);
  }
  return result;
};

const safeDiv = (a, b) => b === 0 ? 0 : a / b;

const parseDate = (dateStr) => {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split(/[-/]/);
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
            // Create date and check if it's valid. Month is 0-indexed.
            const d = new Date(year, month - 1, day);
            if (!isNaN(d.getTime())) {
                return d;
            }
        }
    }
    // Fallback for other formats or if parsing failed
    const fallback = new Date(dateStr);
    if (!isNaN(fallback.getTime())) {
        return fallback;
    }
    // If all else fails, return a safe, known date instead of 'Invalid Date'
    return new Date(0);
};

// --- Components ---

const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-lg shadow p-4 ${className}`}>{children}</div>
);

const StatCard = ({ title, value, subValue, icon: Icon, color = "blue" }) => (
  <Card className="flex items-center space-x-4 border-l-4" style={{ borderLeftColor: `var(--color-${color}-500)` }}>
    <div className={`p-3 rounded-full bg-${color}-100 text-${color}-600`}>
      <Icon size={24} />
    </div>
    <div>
      <p className="text-sm text-gray-500 font-medium">{title}</p>
      <h3 className="text-2xl font-bold text-gray-800">{value}</h3>
      {subValue && <p className="text-xs text-gray-400">{subValue}</p>}
    </div>
  </Card>
);

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [battingData, setBattingData] = useState([]);
  const [pitchingData, setPitchingData] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [importStatus, setImportStatus] = useState("");

  // Filter State
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    teamKeyword: '', 
    category: 'all', 
  });

  // Trends/Analysis State
  const [trendTarget, setTrendTarget] = useState('team'); 
  const [trendType, setTrendType] = useState('batting'); 
  const [selectedPlayerId, setSelectedPlayerId] = useState('');

  // Comparison State
  const [comparisonMetric, setComparisonMetric] = useState('avg');
  const [comparisonMinPA, setComparisonMinPA] = useState(0); // Minimum PA/Innings
  const [comparisonChartType, setComparisonChartType] = useState('ranking'); // 'ranking' or 'scatter'
  const [scatterX, setScatterX] = useState('obp');
  const [scatterY, setScatterY] = useState('slg');

  // Categories & Players List
  const { categories, playerList } = useMemo(() => {
    const cats = new Set();
    const players = new Map();

    battingData.forEach(row => {
        if (row['タイトル']) cats.add(row['タイトル']);
        const pid = row['選手ID'] || row['名前'];
        if (!players.has(pid)) {
            players.set(pid, { id: pid, name: row['名前'], number: row['背番号'] });
        }
    });

    pitchingData.forEach(row => {
        const pid = row['選手ID'] || row['名前'];
        if (!players.has(pid)) {
            players.set(pid, { id: pid, name: row['名前'], number: row['背番号'] });
        }
    });
    
    const sortedPlayers = Array.from(players.values()).sort((a, b) => {
        const numA = parseInt(a.number) || 999;
        const numB = parseInt(b.number) || 999;
        return numA - numB;
    });

    return { 
        categories: Array.from(cats).sort(),
        playerList: sortedPlayers
    };
  }, [battingData, pitchingData]);

  useEffect(() => {
    if (playerList.length > 0 && !selectedPlayerId) {
        setSelectedPlayerId(playerList[0].id);
    }
  }, [playerList]);

  // Load data & Initialize Default Data
  useEffect(() => {
    const savedBatting = localStorage.getItem('bb_stats_batting');
    const savedPitching = localStorage.getItem('bb_stats_pitching');
    const savedDate = localStorage.getItem('bb_stats_date');

    if (savedBatting && JSON.parse(savedBatting).length > 0) {
      setBattingData(JSON.parse(savedBatting));
      if (savedPitching) setPitchingData(JSON.parse(savedPitching));
      if (savedDate) setLastUpdated(savedDate);
    } else {
      // Load Default Data if empty
      loadDefaultData();
    }
  }, []);

  const loadDefaultData = async () => {
    try {
      const [battingRes, pitchingRes] = await Promise.all([
        fetch(DEFAULT_BATTING_CSV_URL),
        fetch(DEFAULT_PITCHING_CSV_URL)
      ]);
      const [battingText, pitchingText] = await Promise.all([battingRes.text(), pitchingRes.text()]);
      setBattingData(parseCSV(battingText));
      setPitchingData(parseCSV(pitchingText));
      const now = new Date().toLocaleString('ja-JP');
      setLastUpdated(now + " (サンプル)");
    } catch (error) {
      console.error("Error loading default CSV data:", error);
      setImportStatus("サンプルの読み込みに失敗しました。");
    }
  };

  // --- Handlers ---

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    let newBatting = [...battingData];
    let newPitching = [...pitchingData];
    let importedCount = 0;

    setImportStatus("読み込み中...");

    for (const file of files) {
      const text = await file.text();
      const data = parseCSV(text);
      
      if (file.name.includes('_b.csv') || (data[0] && '打席数' in data[0])) {
        newBatting = data; 
        importedCount++;
      } else if (file.name.includes('_p.csv') || (data[0] && '投球回' in data[0] || '球数' in data[0])) {
        newPitching = data;
        importedCount++;
      }
    }

    setBattingData(newBatting);
    setPitchingData(newPitching);
    
    const now = new Date().toLocaleString('ja-JP');
    localStorage.setItem('bb_stats_batting', JSON.stringify(newBatting));
    localStorage.setItem('bb_stats_pitching', JSON.stringify(newPitching));
    localStorage.setItem('bb_stats_date', now);
    setLastUpdated(now);
    setImportStatus(`${importedCount}ファイルをインポートしました`);
    setTimeout(() => setImportStatus(""), 3000);
  };

  const clearData = () => {
    if (window.confirm("全てのデータを削除しますか？\n（削除後は初期サンプルデータに戻ります）")) {
      localStorage.removeItem('bb_stats_batting');
      localStorage.removeItem('bb_stats_pitching');
      localStorage.removeItem('bb_stats_date');
      loadDefaultData();
    }
  };

  const resetFilters = () => {
      setFilters({
        startDate: '',
        endDate: '',
        teamKeyword: '',
        category: 'all',
      });
  };

  // --- Filtering Logic ---

  const filterData = (data) => {
    return data.filter(row => {
        const rowDate = parseDate(row['日付']); // Correctly parsed as local time midnight
        let start = null;
        if (filters.startDate) {
            start = parseDate(filters.startDate); // Use the same robust parsing
        }
        let end = null;
        if (filters.endDate) {
            end = parseDate(filters.endDate);
            end.setDate(end.getDate() + 1); // Get the very start of the next day
        }

        if (start && rowDate < start) return false;
        if (end && rowDate >= end) return false;

        if (filters.teamKeyword) {
            const kw = filters.teamKeyword.toLowerCase();
            const teamA = (row['先攻'] || '').toLowerCase();
            const teamB = (row['後攻'] || '').toLowerCase();
            if (!teamA.includes(kw) && !teamB.includes(kw)) return false;
        }

        if (filters.category !== 'all' && row['タイトル'] !== filters.category) return false;

        return true;
    });
  };

  const filteredBattingData = useMemo(() => filterData(battingData), [battingData, filters]);
  const filteredPitchingData = useMemo(() => filterData(pitchingData), [pitchingData, filters]);

  // --- Aggregation Logic ---

  const aggregatedBatting = useMemo(() => {
    const stats = {};
    filteredBattingData.forEach(row => {
      const id = row['選手ID'] || row['名前'];
      if (!stats[id]) {
        stats[id] = {
          id: row['選手ID'], name: row['名前'], number: row['背番号'],
          games: 0, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, 
          rbi: 0, runs: 0, so: 0, bb: 0, hbp: 0, sb: 0, sf: 0, sac: 0
        };
      }
      const s = stats[id];
      s.games += 1;
      s.pa += (row['打席数'] || 0);
      s.ab += (row['打数'] || 0);
      s.h += (row['安打'] || 0);
      s.doubles += (row['二塁打'] || 0);
      s.triples += (row['三塁打'] || 0);
      s.hr += (row['本塁打'] || 0);
      s.rbi += (row['打点'] || 0);
      s.runs += (row['得点'] || 0);
      s.so += (row['三振'] || 0);
      s.bb += (row['四球'] || 0);
      s.hbp += (row['死球'] || 0);
      s.sb += (row['盗塁'] || 0);
      s.sf += (row['犠飛'] || 0);
      s.sac += (row['犠打'] || 0);
    });

    return Object.values(stats).map(s => {
      const avg = safeDiv(s.h, s.ab);
      const obp = safeDiv(s.h + s.bb + s.hbp, s.ab + s.bb + s.hbp + s.sf);
      const singles = s.h - s.doubles - s.triples - s.hr;
      const totalBases = singles + (s.doubles * 2) + (s.triples * 3) + (s.hr * 4);
      const slg = safeDiv(totalBases, s.ab);
      const ops = obp + slg;
      const bbK = safeDiv(s.bb + s.hbp, s.so);
      const isoD = obp - avg;

      return {
        ...s,
        avg: Number(avg.toFixed(3)), 
        obp: Number(obp.toFixed(3)), 
        slg: Number(slg.toFixed(3)), 
        ops: Number(ops.toFixed(3)), 
        bbK: Number(bbK.toFixed(2)),
        isoD: Number(isoD.toFixed(3))
      };
    }).sort((a, b) => b.avg - a.avg);
  }, [filteredBattingData, filters]);

  const aggregatedPitching = useMemo(() => {
    const stats = {};
    filteredPitchingData.forEach(row => {
      const id = row['選手ID'] || row['名前'];
      if (!stats[id]) {
        stats[id] = {
          id: row['選手ID'], name: row['名前'], number: row['背番号'],
          games: 0, outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, win: 0, loss: 0, sv: 0
        };
      }
      const s = stats[id];
      s.games += 1;
      s.outs += (row['アウト数'] || 0);
      s.h += (row['安打'] || 0);
      s.r += (row['失点'] || 0);
      s.er += (row['自責点'] || 0);
      s.bb += (row['四球'] || 0);
      s.so += (row['三振'] || 0);
      s.win += (row['勝数'] || 0);
      s.loss += (row['負数'] || 0);
      s.sv += (row['セーブ'] || 0);
    });

    return Object.values(stats).map(s => {
      const displayInnings = `${Math.floor(s.outs / 3)}${s.outs % 3 > 0 ? '.' + (s.outs % 3) : ''}`;
      const era = safeDiv(s.er * 7, s.outs / 3);
      const whip = safeDiv(s.bb + s.h, s.outs / 3);
      const kbb = safeDiv(s.so, s.bb);

      return {
        ...s,
        displayInnings, 
        era: Number(era.toFixed(2)), 
        whip: Number(whip.toFixed(2)), 
        kbb: Number(kbb.toFixed(2)),
        inningsVal: s.outs / 3
      };
    }).sort((a, b) => a.era - b.era);
  }, [filteredPitchingData, filters]);

  const teamStats = useMemo(() => {
    if (filteredBattingData.length === 0) return null;
    const gameIds = new Set(filteredBattingData.map(r => r['試合ID']));
    const totalAB = aggregatedBatting.reduce((acc, cur) => acc + cur.ab, 0);
    const totalH = aggregatedBatting.reduce((acc, cur) => acc + cur.h, 0);
    const totalR = aggregatedBatting.reduce((acc, cur) => acc + cur.runs, 0);
    const totalHR = aggregatedBatting.reduce((acc, cur) => acc + cur.hr, 0);
    const teamAvg = safeDiv(totalH, totalAB).toFixed(3);
    const totalER = aggregatedPitching.reduce((acc, cur) => acc + cur.er, 0);
    const totalOuts = aggregatedPitching.reduce((acc, cur) => acc + cur.outs, 0);
    const teamERA = safeDiv(totalER * 7, totalOuts / 3).toFixed(2);
    return { totalGames: gameIds.size, teamAvg, totalR, totalHR, teamERA };
  }, [filteredBattingData, aggregatedBatting, aggregatedPitching, filters]);

  const monthlyBattingTrend = useMemo(() => {
     if (filteredBattingData.length === 0) return [];
     const monthly = {};
     filteredBattingData.forEach(row => {
         const dateParts = row['日付'].split(/[-/]/);
         if (dateParts.length < 2) return;
         const key = `${dateParts[0]}-${dateParts[1].padStart(2, '0')}`;
         if (!monthly[key]) monthly[key] = { month: key, ab: 0, h: 0, bb: 0, sf: 0, runs: 0, doubles: 0, triples: 0, hr: 0 };
         
         monthly[key].ab += (row['打数'] || 0);
         monthly[key].h += (row['安打'] || 0);
         monthly[key].runs += (row['得点'] || 0);
         monthly[key].bb += (row['四球'] || 0) + (row['死球'] || 0);
         monthly[key].sf += (row['犠飛'] || 0);
         monthly[key].doubles += (row['二塁打'] || 0);
         monthly[key].triples += (row['三塁打'] || 0);
         monthly[key].hr += (row['本塁打'] || 0);
     });
     
     return Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)).map(m => {
        const avg = safeDiv(m.h, m.ab);
        const obp = safeDiv(m.h + m.bb, m.ab + m.bb + m.sf);
        const slg = safeDiv((m.h - m.doubles - m.triples - m.hr) + m.doubles*2 + m.triples*3 + m.hr*4, m.ab);
        return {
           ...m,
           avg: Number(avg.toFixed(3)),
           ops: Number((obp + slg).toFixed(3))
        };
     });
  }, [filteredBattingData, filters]);

  // Player Cumulative Trend Logic
  const playerBattingTrendData = useMemo(() => {
    if (!selectedPlayerId || trendTarget !== 'player' || trendType !== 'batting') return [];

    const rows = filteredBattingData.filter(r => (r['選手ID'] || r['名前']) === selectedPlayerId);
    rows.sort((a, b) => parseDate(a['日付']) - parseDate(b['日付']));

    let cumulative = { ab: 0, h: 0, bb: 0, sf: 0, doubles: 0, triples: 0, hr: 0 };
    
    return rows.map(row => {
        cumulative.ab += (row['打数'] || 0);
        cumulative.h += (row['安打'] || 0);
        cumulative.bb += (row['四球'] || 0) + (row['死球'] || 0);
        cumulative.sf += (row['犠飛'] || 0);
        cumulative.doubles += (row['二塁打'] || 0);
        cumulative.triples += (row['三塁打'] || 0);
        cumulative.hr += (row['本塁打'] || 0);

        const avg = safeDiv(cumulative.h, cumulative.ab);
        const obp = safeDiv(cumulative.h + cumulative.bb, cumulative.ab + cumulative.bb + cumulative.sf);
        const singles = cumulative.h - cumulative.doubles - cumulative.triples - cumulative.hr;
        const tb = singles + cumulative.doubles*2 + cumulative.triples*3 + cumulative.hr*4;
        const slg = safeDiv(tb, cumulative.ab);

        // Determine opponent: if home team is Arinko/Antos, opponent is Away, else Home.
        const homeTeam = row['後攻'] || '';
        const awayTeam = row['先攻'] || '';
        const isHomeArinko = homeTeam.includes('ありんこ') || homeTeam.includes('アントス');
        const opponent = isHomeArinko ? awayTeam : homeTeam;

        return {
            date: row['日付'],
            game: row['試合ID'],
            opponent: opponent,
            avg: Number(avg.toFixed(3)),
            ops: Number((obp + slg).toFixed(3))
        };
    });
  }, [filteredBattingData, selectedPlayerId, trendTarget, trendType, filters]);

  const playerPitchingTrendData = useMemo(() => {
    if (!selectedPlayerId || trendTarget !== 'player' || trendType !== 'pitching') return [];

    const rows = filteredPitchingData.filter(r => (r['選手ID'] || r['名前']) === selectedPlayerId);
    rows.sort((a, b) => parseDate(a['日付']) - parseDate(b['日付']));

    let cumulative = { outs: 0, er: 0, bb: 0, h: 0, so: 0 };
    
    return rows.map(row => {
        const outs = (row['アウト数'] || 0);
        const er = (row['自責点'] || 0);
        const bb = (row['四球'] || 0);
        const h = (row['安打'] || 0);
        const so = (row['三振'] || 0);
        const pitches = (row['球数'] || 0);
        const strikes = (row['S数'] || 0);
        
        cumulative.outs += outs;
        cumulative.er += er;
        cumulative.bb += bb;
        cumulative.h += h;
        cumulative.so += so;

        const era = safeDiv(cumulative.er * 7, cumulative.outs / 3);
        const whip = safeDiv(cumulative.bb + cumulative.h, cumulative.outs / 3);
        const kbb = safeDiv(cumulative.so, cumulative.bb);

        const innings = outs / 3;
        const strikeRate = safeDiv(strikes, pitches) * 100;
        
        // Determine opponent
        const homeTeam = row['後攻'] || '';
        const awayTeam = row['先攻'] || '';
        const isHomeArinko = homeTeam.includes('ありんこ') || homeTeam.includes('アントス');
        const opponent = isHomeArinko ? awayTeam : homeTeam;

        return {
            date: row['日付'],
            opponent: opponent,
            era: Number(era.toFixed(2)),
            whip: Number(whip.toFixed(2)),
            kbb: Number(kbb.toFixed(2)),
            innings: Number(innings.toFixed(1)),
            strikeRate: Number(strikeRate.toFixed(1)),
            bb: bb,
            pitches: pitches
        };
    });
  }, [filteredPitchingData, selectedPlayerId, trendTarget, trendType, filters]);

  // --- Comparison & Ranking Logic ---

  const rankingData = useMemo(() => {
      let data = [];
      const isPitching = ['era', 'whip', 'kbb', 'so', 'win'].includes(comparisonMetric);

      if (isPitching) {
          data = aggregatedPitching
            .filter(p => p.inningsVal >= comparisonMinPA)
            .map(p => ({
                name: p.name,
                value: p[comparisonMetric],
                displayValue: p[comparisonMetric]
            }));
      } else {
          data = aggregatedBatting
            .filter(p => p.pa >= comparisonMinPA)
            .map(p => ({
                name: p.name,
                value: p[comparisonMetric],
                displayValue: p[comparisonMetric]
            }));
      }
      
      // Sort logic
      // Lower is better for ERA, WHIP
      if (['era', 'whip'].includes(comparisonMetric)) {
          data.sort((a, b) => a.value - b.value);
      } else {
          data.sort((a, b) => b.value - a.value);
      }
      return data;
  }, [aggregatedBatting, aggregatedPitching, comparisonMetric, comparisonMinPA, filters]);

  const comparisonScatterData = useMemo(() => {
      // Assuming batting metrics mostly, but could mix if needed. Sticking to batting for scatter primarily.
      return aggregatedBatting
        .filter(p => p.pa >= comparisonMinPA)
        .map(p => ({
            name: p.name,
            x: p[scatterX],
            y: p[scatterY],
            z: p.pa // size
        }));
  }, [aggregatedBatting, comparisonMinPA, scatterX, scatterY, filters]);

  // --- Render Sub-Components ---

  const FilterPanel = () => (
    <Card className="mb-6 border border-blue-100 bg-blue-50">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">期間指定</label>
                <div className="flex items-center gap-2">
                    <input 
                        type="date" 
                        value={filters.startDate}
                        onChange={e => setFilters({...filters, startDate: e.target.value})}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                    />
                    <span className="text-gray-400">～</span>
                    <input 
                        type="date" 
                        value={filters.endDate}
                        onChange={e => setFilters({...filters, endDate: e.target.value})}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                    />
                </div>
            </div>
            <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">チーム名（部分一致）</label>
                <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search size={14} className="text-gray-400" />
                    </div>
                    <input 
                        type="text" 
                        placeholder="例: A軍, B軍" 
                        value={filters.teamKeyword}
                        onChange={e => setFilters({...filters, teamKeyword: e.target.value})}
                        className="block w-full pl-10 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                    />
                </div>
            </div>
            <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">大会・カテゴリ</label>
                <select 
                    value={filters.category}
                    onChange={e => setFilters({...filters, category: e.target.value})}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border bg-white"
                >
                    <option value="all">全て</option>
                    {categories.map(c => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
            </div>
            <div>
                <button 
                    onClick={resetFilters}
                    className="flex items-center justify-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
                >
                    <RefreshCw size={14} className="mr-2" />
                    リセット
                </button>
            </div>
        </div>
    </Card>
  );

  const ImportSection = () => (
    <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
      <div className="text-center">
        <Database className="mx-auto h-12 w-12 text-blue-500" />
        <h3 className="mt-2 text-lg font-medium text-gray-900">データをインポート</h3>
        <p className="mt-1 text-sm text-gray-500">
          `scorer_stats_raw_*.csv` ファイルを選択してください。（複数選択可）
        </p>
        <div className="mt-6 flex justify-center flex-col items-center gap-4">
          <label className="relative cursor-pointer bg-blue-600 rounded-md font-medium text-white hover:bg-blue-700 px-6 py-2 shadow-sm transition-all">
            <span>ファイルを選択</span>
            <input 
              id="file-upload" 
              name="file-upload" type="file" className="sr-only" multiple accept=".csv"
              onChange={handleFileUpload}
            />
          </label>
          {importStatus && <span className="text-sm text-blue-600 font-semibold animate-pulse">{importStatus}</span>}
        </div>
        
        <div className="mt-8">
            <p className="text-xs text-gray-400 mb-2">※ 初期状態に戻すには「データをクリア」を押してください</p>
        </div>
      </div>
      {lastUpdated && (
        <div className="mt-6 pt-4 border-t flex justify-between items-center">
          <span className="text-xs text-gray-400">最終更新: {lastUpdated}</span>
          <button 
            onClick={clearData}
            className="flex items-center text-xs text-red-500 hover:text-red-700"
          >
            <Trash2 size={12} className="mr-1" />
            データをクリア
          </button>
        </div>
      )}
    </div>
  );

  const DashboardView = () => (
    <div className="space-y-6">
      <FilterPanel />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="集計試合数" value={teamStats?.totalGames || 0} icon={Activity} color="indigo" />
        <StatCard title="チーム打率" value={teamStats?.teamAvg || ".000"} subValue={`${aggregatedBatting.reduce((a,c)=>a+c.h,0)}安打`} icon={TrendingUp} color="green" />
        <StatCard title="総得点" value={teamStats?.totalR || 0} subValue={`本塁打: ${teamStats?.totalHR || 0}`} icon={Award} color="yellow" />
        <StatCard title="チーム防御率" value={teamStats?.teamERA || "0.00"} subValue="（7回換算）" icon={AlertCircle} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="h-96">
          <h3 className="text-lg font-bold text-gray-700 mb-4">月別チーム成績推移</h3>
          <ResponsiveContainer width="100%" height="90%">
            <ComposedChart data={monthlyBattingTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{fontSize: 12}} />
              <YAxis yAxisId="left" orientation="left" stroke="#8884d8" domain={[0, 'auto']} />
              <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" domain={[0, 0.6]} tickFormatter={(val) => val.toFixed(3)} />
              <RechartsTooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="runs" name="得点" fill="#8884d8" barSize={20} />
              <Line yAxisId="right" type="monotone" dataKey="avg" name="打率" stroke="#82ca9d" strokeWidth={3} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card className="h-96">
            <h3 className="text-lg font-bold text-gray-700 mb-2">打撃タイプ分析 (OPS)</h3>
            <p className="text-xs text-gray-400 mb-4">※5打席以上の選手を表示。円の大きさはOPS。</p>
            <ResponsiveContainer width="100%" height="90%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid />
                    <XAxis type="number" dataKey="x" name="出塁率" unit="" domain={[0, 'dataMax + 0.1']} tickFormatter={(v)=>v.toFixed(3)} label={{ value: '出塁率 (OBP)', position: 'insideBottom', offset: -10 }} />
                    <YAxis type="number" dataKey="y" name="長打率" unit="" domain={[0, 'dataMax + 0.1']} tickFormatter={(v)=>v.toFixed(3)} label={{ value: '長打率 (SLG)', angle: -90, position: 'insideLeft' }} />
                    <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                                <div className="bg-white p-2 border shadow-sm rounded-md text-sm">
                                    <p className="font-bold mb-2 text-gray-800">{data.name}</p>
                                    <p style={{ color: payload[0].color }}>
                                        出塁率 (X軸): {data.x}
                                    </p>
                                    <p style={{ color: payload[0].color }}>
                                        長打率 (Y軸): {data.y}
                                    </p>
                                </div>
                            );
                        }
                        return null;
                    }} />
                    <Legend />
                    <Scatter name="選手" data={aggregatedBatting.filter(p => p.pa >= 5).map(p => ({ name: p.name, x: p.obp, y: p.slg, z: p.ops }))} fill="#f59e0b" />
                    <ReferenceLine x={0.3} stroke="red" strokeDasharray="3 3" label="出塁率.300" />
                    <ReferenceLine y={0.3} stroke="blue" strokeDasharray="3 3" label="長打率.300" />
                </ScatterChart>
            </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );

  const ComparisonView = () => {
      const metricOptions = [
          { v: 'avg', l: '打率' }, { v: 'ops', l: 'OPS' }, { v: 'hr', l: '本塁打' },
          { v: 'rbi', l: '打点' }, { v: 'sb', l: '盗塁' }, { v: 'obp', l: '出塁率' },
          { v: 'slg', l: '長打率' }, { v: 'bb', l: '四球' }, { v: 'so', l: '三振' },
          { v: 'era', l: '防御率' }, { v: 'whip', l: 'WHIP' }, { v: 'kbb', l: 'K/BB' }
      ];

      return (
          <div className="space-y-6">
              <FilterPanel />
              
              <div className="bg-white p-4 rounded-lg shadow space-y-4">
                  <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex space-x-2 bg-gray-100 p-1 rounded-lg">
                            <button 
                                onClick={() => setComparisonChartType('ranking')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${comparisonChartType === 'ranking' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                ランキング
                            </button>
                            <button 
                                onClick={() => setComparisonChartType('scatter')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${comparisonChartType === 'scatter' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                相関分析
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <label className="text-sm text-gray-600">
                           {comparisonChartType === 'ranking' && ['era', 'whip', 'win', 'so', 'kbb'].includes(comparisonMetric) ? '最低投球回' : '最低打席数'}: 
                        </label>
                        <input 
                            type="number" 
                            min="0"
                            value={comparisonMinPA}
                            onChange={(e) => setComparisonMinPA(Number(e.target.value))}
                            className="w-16 p-1 border rounded text-center"
                        />
                    </div>
                  </div>

                  {comparisonChartType === 'ranking' && (
                      <div className="flex items-center gap-2">
                          <label className="text-sm font-bold text-gray-700">指標を選択:</label>
                          <select 
                            value={comparisonMetric}
                            onChange={(e) => setComparisonMetric(e.target.value)}
                            className="p-2 border rounded-md"
                          >
                              {metricOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>
                      </div>
                  )}

                  {comparisonChartType === 'scatter' && (
                      <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                              <label className="text-sm font-bold text-gray-700">X軸:</label>
                              <select 
                                value={scatterX}
                                onChange={(e) => setScatterX(e.target.value)}
                                className="p-2 border rounded-md"
                              >
                                  {metricOptions.filter(m => !['era','whip'].includes(m.v)).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                              </select>
                          </div>
                          <div className="flex items-center gap-2">
                              <label className="text-sm font-bold text-gray-700">Y軸:</label>
                              <select 
                                value={scatterY}
                                onChange={(e) => setScatterY(e.target.value)}
                                className="p-2 border rounded-md"
                              >
                                  {metricOptions.filter(m => !['era','whip'].includes(m.v)).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                              </select>
                          </div>
                      </div>
                  )}
              </div>

              <Card className="h-[500px]">
                  <h3 className="text-lg font-bold text-gray-700 mb-4">
                      {comparisonChartType === 'ranking' ? 
                          `チーム内ランキング: ${metricOptions.find(m => m.v === comparisonMetric)?.l}` : 
                          `相関分析: ${metricOptions.find(m => m.v === scatterX)?.l} vs ${metricOptions.find(m => m.v === scatterY)?.l}`
                      }
                  </h3>
                  
                  {comparisonChartType === 'ranking' ? (
                      <ResponsiveContainer width="100%" height="90%">
                          <BarChart 
                            data={rankingData} 
                            layout="vertical"
                            margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                          >
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                              <XAxis type="number" />
                              <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 11}} interval={0} />
                              <RechartsTooltip cursor={{fill: 'transparent'}} />
                              <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                                  <LabelList dataKey="displayValue" position="right" />
                              </Bar>
                          </BarChart>
                      </ResponsiveContainer>
                  ) : (
                      <ResponsiveContainer width="100%" height="90%">
                          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                <CartesianGrid />
                                <XAxis type="number" dataKey="x" name={scatterX} unit="" domain={['auto', 'auto']} tickFormatter={(v)=> Number(v).toFixed(3)} label={{ value: metricOptions.find(m => m.v === scatterX)?.l, position: 'insideBottom', offset: -10 }} />
                                <YAxis type="number" dataKey="y" name={scatterY} unit="" domain={['auto', 'auto']} tickFormatter={(v)=> Number(v).toFixed(3)} label={{ value: metricOptions.find(m => m.v === scatterY)?.l, angle: -90, position: 'insideLeft' }} />
                                <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="bg-white p-2 border shadow-sm rounded-md text-sm">
                                                <p className="font-bold mb-2 text-gray-800">{data.name}</p>
                                                <p style={{ color: payload[0].color }}>
                                                    {payload[0].name} (X軸): {data.x}
                                                </p>
                                                <p style={{ color: payload[1].color }}>
                                                    {payload[1].name} (Y軸): {data.y}
                                                </p>
                                            </div>
                                        );
                                    }
                                    return null;
                                }} />
                                <Scatter name={metricOptions.find(m => m.v === scatterX)?.l} data={comparisonScatterData} fill="#8884d8" />
                          </ScatterChart>
                      </ResponsiveContainer>
                  )}
              </Card>
          </div>
      );
  };

  const TrendsView = () => {
      const renderPlayerCharts = () => {
          if (trendType === 'batting') {
              return (
                <div className="grid grid-cols-1 gap-6">
                    <Card className="h-96">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-gray-700">累積打撃成績推移</h3>
                            <span className="text-xs text-gray-400">※試合経過に伴う通算成績の変化</span>
                        </div>
                        {playerBattingTrendData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="90%">
                                <LineChart data={playerBattingTrendData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="date" tick={{fontSize: 10}} />
                                    <YAxis domain={[0, 'auto']} />
                                    <RechartsTooltip content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-white p-2 border shadow-sm text-sm">
                                                    <p className="font-bold mb-1">{label}</p>
                                                    <p className="text-gray-500 text-xs mb-2">vs {payload[0].payload.opponent}</p>
                                                    {payload.map(p => (
                                                        <p key={p.name} style={{color: p.color}}>
                                                            {p.name}: {p.value}
                                                        </p>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}/>
                                    <Legend />
                                    <Line type="stepAfter" dataKey="avg" name="累積打率" stroke="#3b82f6" strokeWidth={2} dot={{r: 3}} />
                                    <Line type="stepAfter" dataKey="ops" name="累積OPS" stroke="#f59e0b" strokeWidth={2} dot={{r: 3}} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400">データがありません</div>
                        )}
                    </Card>
                </div>
              );
          } else {
              return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card className="h-96">
                          <h3 className="text-lg font-bold text-gray-700 mb-4">累積防御率・WHIP推移</h3>
                          {playerPitchingTrendData.length > 0 ? (
                              <ResponsiveContainer width="100%" height="90%">
                                  <LineChart data={playerPitchingTrendData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="date" tick={{fontSize: 10}} />
                                      <YAxis yAxisId="left" domain={[0, 'auto']} label={{ value: 'ERA', angle: -90, position: 'insideLeft' }} />
                                      <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} label={{ value: 'WHIP', angle: 90, position: 'insideRight' }} />
                                      <RechartsTooltip />
                                      <Legend />
                                      <Line yAxisId="left" type="monotone" dataKey="era" name="累積防御率" stroke="#ef4444" strokeWidth={2} dot={{r: 3}} />
                                      <Line yAxisId="right" type="monotone" dataKey="whip" name="累積WHIP" stroke="#8b5cf6" strokeWidth={2} dot={{r: 3}} />
                                  </LineChart>
                              </ResponsiveContainer>
                          ) : (
                              <div className="h-full flex items-center justify-center text-gray-400">データがありません</div>
                          )}
                      </Card>

                      <Card className="h-96">
                          <h3 className="text-lg font-bold text-gray-700 mb-4">試合別 投球内容 (回・S率)</h3>
                          {playerPitchingTrendData.length > 0 ? (
                              <ResponsiveContainer width="100%" height="90%">
                                  <ComposedChart data={playerPitchingTrendData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="date" tick={{fontSize: 10}} />
                                      <YAxis yAxisId="left" label={{ value: '回', angle: -90, position: 'insideLeft' }} />
                                      <YAxis yAxisId="right" orientation="right" unit="%" domain={[0, 100]} />
                                      <RechartsTooltip content={({ active, payload, label }) => {
                                          if (active && payload && payload.length) {
                                              const data = payload[0].payload;
                                              return (
                                                  <div className="bg-white p-2 border shadow-sm text-sm z-50">
                                                      <p className="font-bold mb-1">{label}</p>
                                                      <p className="text-gray-500 text-xs mb-2">vs {data.opponent}</p>
                                                      <p className="text-blue-600">投球回: {data.innings}</p>
                                                      <p className="text-green-600">ストライク率: {data.strikeRate}%</p>
                                                      <p className="text-gray-600">球数: {data.pitches}</p>
                                                      <p className="text-red-600">四球: {data.bb}</p>
                                                  </div>
                                              );
                                          }
                                          return null;
                                      }} />
                                      <Legend />
                                      <Bar yAxisId="left" dataKey="innings" name="投球回" fill="#3b82f6" barSize={20} />
                                      <Line yAxisId="right" type="monotone" dataKey="strikeRate" name="S率(%)" stroke="#10b981" strokeWidth={2} />
                                  </ComposedChart>
                              </ResponsiveContainer>
                          ) : (
                              <div className="h-full flex items-center justify-center text-gray-400">データがありません</div>
                          )}
                      </Card>

                      <Card className="h-96">
                          <h3 className="text-lg font-bold text-gray-700 mb-4">累積K/BB推移</h3>
                          {playerPitchingTrendData.length > 0 ? (
                              <ResponsiveContainer width="100%" height="90%">
                                  <LineChart data={playerPitchingTrendData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="date" tick={{fontSize: 10}} />
                                      <YAxis domain={[0, 'auto']} label={{ value: 'K/BB', angle: -90, position: 'insideLeft' }} />
                                      <RechartsTooltip />
                                      <Legend />
                                      <Line type="monotone" dataKey="kbb" name="累積K/BB" stroke="#22c55e" strokeWidth={2} dot={{r: 3}} />
                                      <ReferenceLine y={1.0} stroke="red" strokeDasharray="3 3" label={{ value: '1.0', position: 'insideTopRight' }} />
                                  </LineChart>
                              </ResponsiveContainer>
                          ) : (
                              <div className="h-full flex items-center justify-center text-gray-400">データがありません</div>
                          )}
                      </Card>
                  </div>
              );
          }
      };

      return (
          <div className="space-y-6">
              <FilterPanel />
              <div className="bg-white p-4 rounded-lg shadow space-y-4">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex space-x-2 bg-gray-100 p-1 rounded-lg">
                          <button 
                              onClick={() => setTrendTarget('team')}
                              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${trendTarget === 'team' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                          >
                              チーム推移
                          </button>
                          <button 
                              onClick={() => setTrendTarget('player')}
                              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${trendTarget === 'player' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                          >
                              個人推移
                          </button>
                      </div>
                      
                      {trendTarget === 'player' && (
                          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                              <select 
                                  value={selectedPlayerId}
                                  onChange={e => setSelectedPlayerId(e.target.value)}
                                  className="block w-full sm:w-64 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              >
                                  {playerList.map(p => (
                                      <option key={p.id} value={p.id}>{p.number} - {p.name}</option>
                                  ))}
                              </select>
                              
                              <div className="flex space-x-2 bg-gray-100 p-1 rounded-lg">
                                <button 
                                    onClick={() => setTrendType('batting')}
                                    className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${trendType === 'batting' ? 'bg-blue-500 text-white shadow' : 'text-gray-500 hover:bg-gray-200'}`}
                                >
                                    打撃
                                </button>
                                <button 
                                    onClick={() => setTrendType('pitching')}
                                    className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${trendType === 'pitching' ? 'bg-red-500 text-white shadow' : 'text-gray-500 hover:bg-gray-200'}`}
                                >
                                    投手
                                </button>
                              </div>
                          </div>
                      )}
                  </div>
              </div>

              {trendTarget === 'team' ? (
                 <div className="grid grid-cols-1 gap-6">
                    <Card className="h-96">
                        <h3 className="text-lg font-bold text-gray-700 mb-4">チーム打撃成績推移（月別）</h3>
                        <ResponsiveContainer width="100%" height="90%">
                            <LineChart data={monthlyBattingTrend}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" />
                                <YAxis yAxisId="left" domain={[0, 0.6]} />
                                <YAxis yAxisId="right" orientation="right" domain={[0, 1.2]} />
                                <RechartsTooltip />
                                <Legend />
                                <Line yAxisId="left" type="monotone" dataKey="avg" name="打率" stroke="#3b82f6" strokeWidth={3} />
                                <Line yAxisId="right" type="monotone" dataKey="ops" name="OPS" stroke="#f59e0b" strokeWidth={3} />
                            </LineChart>
                        </ResponsiveContainer>
                    </Card>
                 </div>
              ) : (
                  renderPlayerCharts()
              )}
          </div>
      );
  };

  const BattingView = () => {
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });
    const requestSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
        setSortConfig({ key, direction });
    };

    const sortedData = useMemo(() => {
      let sortableItems = [...aggregatedBatting];
      if (sortConfig.key !== null) {
        sortableItems.sort((a, b) => {
           let valA = a[sortConfig.key];
           let valB = b[sortConfig.key];
           if (!isNaN(Number(valA))) valA = Number(valA);
           if (!isNaN(Number(valB))) valB = Number(valB);
           if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
           if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
           return 0;
        });
      }
      return sortableItems;
    }, [aggregatedBatting, sortConfig]);

    const headers = [
      { k: 'number', l: '#' }, { k: 'name', l: '名前' }, { k: 'games', l: '試合' }, 
      { k: 'pa', l: '打席' }, { k: 'ab', l: '打数' }, { k: 'h', l: '安打' }, 
      { k: 'hr', l: '本塁' }, { k: 'rbi', l: '打点' }, { k: 'sb', l: '盗塁' }, 
      { k: 'bb', l: '四球' }, { k: 'so', l: '三振' },
      { k: 'avg', l: '打率' }, { k: 'obp', l: '出塁' }, { k: 'ops', l: 'OPS' },
      { k: 'bbK', l: 'BB/K' }
    ];

    return (
      <div className="space-y-4">
        <FilterPanel />
        <Card className="overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                <tr>
                    {headers.map(h => (
                    <th key={h.k} onClick={() => requestSort(h.k)} className={`px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 ${sortConfig.key === h.k ? 'bg-gray-100 text-blue-600' : ''}`}>
                        {h.l}
                    </th>
                    ))}
                </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                {sortedData.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{row.number}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">{row.name}</td>
                    <td className="px-3 py-2 text-gray-600">{row.games}</td>
                    <td className="px-3 py-2 text-gray-600">{row.pa}</td>
                    <td className="px-3 py-2 text-gray-600">{row.ab}</td>
                    <td className="px-3 py-2 text-gray-900 font-bold">{row.h}</td>
                    <td className="px-3 py-2 text-pink-600 font-bold">{row.hr}</td>
                    <td className="px-3 py-2 text-blue-600">{row.rbi}</td>
                    <td className="px-3 py-2 text-green-600">{row.sb}</td>
                    <td className="px-3 py-2 text-gray-400">{row.bb}</td>
                    <td className="px-3 py-2 text-gray-400">{row.so}</td>
                    <td className="px-3 py-2 bg-yellow-50 font-bold text-gray-900">{row.avg}</td>
                    <td className="px-3 py-2 text-gray-600">{row.obp}</td>
                    <td className="px-3 py-2 text-gray-600">{row.ops}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{row.bbK}</td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>
        </Card>
      </div>
    );
  };

  const PitchingView = () => {
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });
    const requestSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
        setSortConfig({ key, direction });
    };

    const sortedData = useMemo(() => {
      let sortableItems = [...aggregatedPitching];
      if (sortConfig.key !== null) {
        sortableItems.sort((a, b) => {
           let valA = a[sortConfig.key];
           let valB = b[sortConfig.key];
           if (!isNaN(Number(valA))) valA = Number(valA);
           if (!isNaN(Number(valB))) valB = Number(valB);
           if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
           if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
           return 0;
        });
      }
      return sortableItems;
    }, [aggregatedPitching, sortConfig]);

    const headers = [
      { k: 'number', l: '#' }, { k: 'name', l: '名前' }, { k: 'games', l: '登板' }, 
      { k: 'displayInnings', l: '回' }, { k: 'win', l: '勝' }, { k: 'loss', l: '敗' },
      { k: 'sv', l: 'S' }, { k: 'so', l: '奪三振' }, { k: 'bb', l: '四球' },
      { k: 'era', l: '防御率' }, { k: 'whip', l: 'WHIP' }, { k: 'kbb', l: 'K/BB' }
    ];

    return (
       <div className="space-y-4">
        <FilterPanel />
        <Card className="overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                <tr>
                    {headers.map(h => (
                    <th key={h.k} onClick={() => requestSort(h.k)} className={`px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 ${sortConfig.key === h.k ? 'bg-gray-100 text-blue-600' : ''}`}>
                        {h.l}
                    </th>
                    ))}
                </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                {sortedData.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{row.number}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">{row.name}</td>
                    <td className="px-3 py-2 text-gray-600">{row.games}</td>
                    <td className="px-3 py-2 text-gray-900">{row.displayInnings}</td>
                    <td className="px-3 py-2 text-red-600 font-bold">{row.win}</td>
                    <td className="px-3 py-2 text-blue-600">{row.loss}</td>
                    <td className="px-3 py-2 text-gray-600">{row.sv}</td>
                    <td className="px-3 py-2 text-green-600 font-bold">{row.so}</td>
                    <td className="px-3 py-2 text-gray-400">{row.bb}</td>
                    <td className="px-3 py-2 bg-yellow-50 font-bold text-gray-900">{row.era}</td>
                    <td className="px-3 py-2 text-gray-600">{row.whip}</td>
                    <td className="px-3 py-2 text-gray-400">{row.kbb}</td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-gray-800">
      <header className="bg-blue-900 text-white shadow-lg sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Award className="h-8 w-8 text-yellow-400" />
              <h1 className="text-xl font-bold tracking-tight">少年野球Stats Manager</h1>
            </div>
            <div className="flex space-x-1 overflow-x-auto">
              <button onClick={() => setActiveTab('dashboard')} className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-800'}`}>ホーム</button>
              <button onClick={() => setActiveTab('batting')} className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'batting' ? 'bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-800'}`}>打撃成績</button>
              <button onClick={() => setActiveTab('pitching')} className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'pitching' ? 'bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-800'}`}>投手成績</button>
              <button onClick={() => setActiveTab('trends')} className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'trends' ? 'bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-800'} flex items-center`}>
                  <LineChartIcon className="w-4 h-4 mr-1"/>推移
              </button>
              <button onClick={() => setActiveTab('comparison')} className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'comparison' ? 'bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-800'} flex items-center`}>
                  <BarChart2 className="w-4 h-4 mr-1"/>分析・比較
              </button>
              <button onClick={() => setActiveTab('settings')} className={`ml-4 px-3 py-2 rounded-md text-sm font-medium transition-colors bg-blue-700 hover:bg-blue-600 text-white flex items-center`}><Save className="w-4 h-4 mr-1" />データ管理</button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!lastUpdated && activeTab !== 'settings' && (
           <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-2xl mx-auto mt-10">
             <div className="bg-blue-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"><Upload className="text-blue-600 w-10 h-10" /></div>
             <h2 className="text-2xl font-bold text-gray-800 mb-2">データがありません</h2>
             <p className="text-gray-500 mb-6">まずは「データ管理」からCSVファイルをインポートしてください。<br/>成績データをドラッグ＆ドロップで読み込めます。</p>
             <button onClick={() => setActiveTab('settings')} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold shadow hover:bg-blue-700 transition-colors">データをインポートする</button>
           </div>
        )}

        {lastUpdated && activeTab === 'dashboard' && <DashboardView />}
        {lastUpdated && activeTab === 'batting' && <BattingView />}
        {lastUpdated && activeTab === 'pitching' && <PitchingView />}
        {lastUpdated && activeTab === 'trends' && <TrendsView />}
        {lastUpdated && activeTab === 'comparison' && <ComparisonView />}
        {activeTab === 'settings' && <ImportSection />}
      </main>
      
      <footer className="bg-slate-200 mt-12 py-6 text-center text-sm text-gray-500">
        <p>Data stored locally in your browser. Clearing cache will remove stats.</p>
        <p className="mt-1">少年野球Stats Manager v1.4</p>
      </footer>
    </div>
  );
}