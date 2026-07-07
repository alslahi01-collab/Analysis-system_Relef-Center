import * as XLSX from 'xlsx';
import { DatasetProfile, ColumnProfile, FrequencyItem, CrosstabProfile, CrosstabMatrix, VariableType } from '../types';

// Detect variable type based on column name and values
export function detectVariableType(name: string, values: any[]): VariableType {
  const nonNullValues = values.filter(v => v !== undefined && v !== null && v !== '');
  if (nonNullValues.length === 0) return 'text';

  // Check if numerical
  const numericCount = nonNullValues.filter(v => !isNaN(Number(v))).length;
  if (numericCount / nonNullValues.length > 0.9) {
    // If it's all 0/1, it might be boolean, but numerical is safer
    return 'numerical';
  }

  const nameLower = name.toLowerCase();
  
  // Check if demographic keywords are present
  const demographicKeywords = [
    'النوع', 'الجنس', 'جنس', 'عمر', 'العمر', 'منطقة', 'المنطقة', 'محافظة', 'المحافظة', 'مديرية',
    'بلد', 'البلد', 'حالة', 'الحالة', 'gender', 'age', 'region', 'governorate', 'district', 'country', 'status', 'demographic'
  ];
  const isDemographic = demographicKeywords.some(keyword => nameLower.includes(keyword) || name.includes(keyword));

  // Check if boolean (Yes/No)
  const booleanValues = ['نعم', 'لا', 'صح', 'خطأ', 'yes', 'no', 'true', 'false', 'موافق', 'غير موافق', 'أوافق', 'لا أوافق'];
  const uniqueVals = Array.from(new Set(nonNullValues.map(v => String(v).trim())));
  const isBooleanLike = uniqueVals.length <= 3 && uniqueVals.every(v => booleanValues.some(b => v.toLowerCase().includes(b)));
  
  if (isBooleanLike) {
    return 'boolean';
  }

  // Check if ordinal scale (Likert, levels)
  const ordinalKeywords = [
    'موافق بشدة', 'موافق', 'محايد', 'غير موافق', 'غير موافق بشدة',
    'ممتاز', 'جيد جداً', 'جيد', 'مقبول', 'ضعيف', 'سيء',
    'دائماً', 'غالباً', 'أحياناً', 'نادراً', 'أبداً',
    'مرتفع', 'متوسط', 'منخفض', 'كبير', 'قليل',
    'agree', 'disagree', 'neutral', 'excellent', 'good', 'poor', 'high', 'medium', 'low'
  ];
  const hasOrdinalKeywords = uniqueVals.some(v => ordinalKeywords.some(ok => v.includes(ok)));
  if (hasOrdinalKeywords && uniqueVals.length <= 10) {
    return 'ordinal';
  }

  if (isDemographic && uniqueVals.length <= 15) {
    return 'demographic';
  }

  // Categorical if unique values are limited
  if (uniqueVals.length <= 15 || (uniqueVals.length <= 30 && uniqueVals.length / nonNullValues.length < 0.3)) {
    return 'categorical';
  }

  return 'text';
}

// Compute statistics for a column
export function analyzeColumn(name: string, rawValues: any[], type: VariableType): ColumnProfile {
  const totalCount = rawValues.length;
  const nonNullValues = rawValues.filter(v => v !== undefined && v !== null && v !== '');
  const validCount = nonNullValues.length;
  const missingCount = totalCount - validCount;
  const missingPercentage = Number(((missingCount / totalCount) * 100).toFixed(2));

  // Calculate frequencies
  const frequenciesMap: { [key: string]: number } = {};
  nonNullValues.forEach(val => {
    const stringVal = String(val).trim();
    frequenciesMap[stringVal] = (frequenciesMap[stringVal] || 0) + 1;
  });

  const frequencies: FrequencyItem[] = Object.entries(frequenciesMap)
    .map(([value, count]) => ({
      value,
      count,
      percentage: Number(((count / validCount) * 100).toFixed(2))
    }))
    // Sort from most common to least common
    .sort((a, b) => b.count - a.count);

  const profile: ColumnProfile = {
    name,
    type,
    totalCount,
    validCount,
    missingCount,
    missingPercentage,
    frequencies
  };

  // For numerical columns, calculate mean, stdDev, min, max
  if (type === 'numerical' && validCount > 0) {
    const numbers = nonNullValues.map(v => Number(v)).filter(n => !isNaN(n));
    if (numbers.length > 0) {
      const min = Math.min(...numbers);
      const max = Math.max(...numbers);
      const sum = numbers.reduce((acc, val) => acc + val, 0);
      const mean = Number((sum / numbers.length).toFixed(2));
      
      // Standard deviation
      let stdDev = 0;
      if (numbers.length > 1) {
        const sqDiffSum = numbers.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
        stdDev = Number(Math.sqrt(sqDiffSum / (numbers.length - 1)).toFixed(2));
      }

      profile.mean = mean;
      profile.stdDev = stdDev;
      profile.min = min;
      profile.max = max;
    }
  }

  return profile;
}

// Generate Cross-tabulation between two columns
export function generateCrosstab(
  rowCol: ColumnProfile,
  colCol: ColumnProfile,
  rowsData: any[]
): CrosstabProfile {
  const rowVar = rowCol.name;
  const colVar = colCol.name;

  // Get distinct values, filter out empty values, limit to top 10 for readability
  const rowValues = rowCol.frequencies.slice(0, 10).map(f => f.value);
  const colValues = colCol.frequencies.slice(0, 10).map(f => f.value);

  const matrix: CrosstabMatrix = {};
  
  // Initialize matrix
  rowValues.forEach(r => {
    matrix[r] = {};
    colValues.forEach(c => {
      matrix[r][c] = { count: 0, percentage: 0 };
    });
  });

  // Fill matrix with raw counts
  let matchCount = 0;
  rowsData.forEach(row => {
    const rVal = String(row[rowVar] || '').trim();
    const cVal = String(row[colVar] || '').trim();

    if (rowValues.includes(rVal) && colValues.includes(cVal)) {
      matrix[rVal][cVal].count++;
      matchCount++;
    }
  });

  // Calculate percentages (Percentage of row total)
  rowValues.forEach(r => {
    const rowTotal = Object.values(matrix[r]).reduce((sum, cell) => sum + cell.count, 0);
    colValues.forEach(c => {
      if (rowTotal > 0) {
        matrix[r][c].percentage = Number(((matrix[r][c].count / rowTotal) * 100).toFixed(2));
      } else {
        matrix[r][c].percentage = 0;
      }
    });
  });

  // Calculate relationship strength and type based on deviation
  // Measure how much row categories differ in their column distribution (conditional vs marginal)
  let maxDeviation = 0;
  rowValues.forEach(r => {
    colValues.forEach(c => {
      // Find overall marginal percentage for col value
      const marginalFreq = colCol.frequencies.find(f => f.value === c);
      const marginalPct = marginalFreq ? marginalFreq.percentage : 0;
      const conditionalPct = matrix[r][c].percentage;
      const deviation = Math.abs(conditionalPct - marginalPct);
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
      }
    });
  });

  let relationshipStrength: 'strong' | 'moderate' | 'weak' | 'none' = 'none';
  if (maxDeviation > 25) {
    relationshipStrength = 'strong';
  } else if (maxDeviation > 12) {
    relationshipStrength = 'moderate';
  } else if (maxDeviation > 4) {
    relationshipStrength = 'weak';
  }

  // Determine direction
  let relationshipType: 'direct' | 'inverse' | 'complex' | 'none' = 'none';
  if (relationshipStrength !== 'none') {
    if ((rowCol.type === 'numerical' || rowCol.type === 'ordinal') && 
        (colCol.type === 'numerical' || colCol.type === 'ordinal')) {
      // Simple direct/inverse check for ordinal/numerical trends
      relationshipType = 'direct'; // Defaulting to complex or direct for categorical
    } else {
      relationshipType = 'complex';
    }
  }

  // Simple automated Arabic insight
  let insight = '';
  if (rowValues.length > 0 && colValues.length > 0) {
    const topRowVal = rowValues[0];
    const topColVals = colValues.map(c => ({
      value: c,
      pct: matrix[topRowVal][c]?.percentage || 0
    })).sort((a, b) => b.pct - a.pct);

    const topColVal = topColVals[0];
    insight = `عند دراسة "${rowVar}" المتمثل في الفئة "${topRowVal}"، لوحظ أن الخيار الغالب لـ "${colVar}" هو "${topColVal.value}" بنسبة بلغت ${topColVal.pct.toFixed(2)}%، مما يشير إلى وجود ترابط (${relationshipStrength === 'strong' ? 'قوي جداً' : relationshipStrength === 'moderate' ? 'متوسط' : 'محدود'}) بين المتغيرين.`;
  } else {
    insight = `لا توجد بيانات كافية لاستخلاص علاقة واضحة بين "${rowVar}" و "${colVar}".`;
  }

  return {
    rowVar,
    colVar,
    matrix,
    rowValues,
    colValues,
    relationshipStrength,
    relationshipType,
    insight
  };
}

// Main parser to read Excel or CSV and construct profile
export async function processFile(file: File, targetSheetName?: string): Promise<DatasetProfile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error('لا توجد بيانات في الملف.');

        let workbook: XLSX.WorkBook;
        if (file.name.endsWith('.csv')) {
          const text = new TextDecoder('utf-8').decode(new Uint8Array(data as ArrayBuffer));
          workbook = XLSX.read(text, { type: 'string' });
        } else {
          workbook = XLSX.read(new Uint8Array(data as ArrayBuffer), { type: 'array' });
        }

        const sheetNames = workbook.SheetNames;
        const selectedSheet = targetSheetName && sheetNames.includes(targetSheetName) ? targetSheetName : sheetNames[0];
        const worksheet = workbook.Sheets[selectedSheet];
        
        // Parse rows including empty lines or with header
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        if (rows.length === 0) {
          throw new Error('ورقة العمل فارغة ولا تحتوي على سجلات.');
        }

        const totalRecords = rows.length;
        
        // Filter out empty rows (where all values are empty strings)
        const validRows = rows.filter(row => {
          return Object.values(row).some(v => v !== undefined && v !== null && String(v).trim() !== '');
        });

        const validRecords = validRows.length;

        // Get headers
        const headers = Object.keys(rows[0]);

        // Build columns profile
        const columns: ColumnProfile[] = headers.map(header => {
          const colValues = validRows.map(row => row[header]);
          const type = detectVariableType(header, colValues);
          return analyzeColumn(header, colValues, type);
        });

        // Search for specific humanitarian/social survey indicators to prioritize bivariate crosstabs
        const isTargetCol = (name: string, keywords: string[]) => {
          const n = name.toLowerCase();
          return keywords.some(k => n.includes(k));
        };

        const demoKeywords = [
          'النوع', 'الجنس', 'جنس', 'عمر', 'العمر', 'المديرية', 'المديريات', 'المحافظة', 'المحافظات', 
          'المنطقة', 'المناطق', 'العزل', 'الحارة', 'القرية', 'gender', 'age', 'district', 'governorate', 'village', 'region'
        ];
        
        const riskKeywords = [
          'إعاقة', 'الاعاقة', 'عاهة', 'صعوبة', 'مخاطر', 'حماية', 'تهديد', 'مخاطر الحماية', 
          'مصدر الدخل', 'الدخل', 'العمل', 'مساعدات', 'دخل', 'معيشي', 'disability', 'risk', 'protection', 'income', 'need'
        ];

        const priorityDemos = columns.filter(c => isTargetCol(c.name, demoKeywords) && c.frequencies.length <= 15);
        const priorityRisks = columns.filter(c => isTargetCol(c.name, riskKeywords) && c.frequencies.length <= 10);

        const crosstabs: CrosstabProfile[] = [];

        // 1. Try to pair priority risks (rows) with priority demographics (cols)
        priorityRisks.forEach(riskCol => {
          priorityDemos.forEach(demoCol => {
            if (riskCol.name !== demoCol.name && crosstabs.length < 12) {
              crosstabs.push(generateCrosstab(riskCol, demoCol, validRows));
            }
          });
        });

        // 2. Standard pairing if list is empty or small
        if (crosstabs.length < 4) {
          const demographicCols = columns.filter(c => c.type === 'demographic' || (c.type === 'categorical' && c.frequencies.length <= 6));
          const topDemos = demographicCols.slice(0, 3);
          const topDeps = columns.filter(c => c.type === 'ordinal' || c.type === 'boolean' || (c.type === 'categorical' && !topDemos.some(td => td.name === c.name))).slice(0, 4);

          topDeps.forEach(dep => {
            topDemos.forEach(demo => {
              if (dep.name !== demo.name && !crosstabs.some(ct => ct.rowVar === dep.name && ct.colVar === demo.name)) {
                crosstabs.push(generateCrosstab(dep, demo, validRows));
              }
            });
          });
        }

        // 3. Fallback to guarantee at least one crosstab
        if (crosstabs.length === 0 && columns.length >= 2) {
          const catCols = columns.filter(c => c.frequencies.length > 0 && c.frequencies.length <= 10);
          if (catCols.length >= 2) {
            crosstabs.push(generateCrosstab(catCols[0], catCols[1], validRows));
          }
        }

        resolve({
          fileName: file.name,
          totalRecords,
          validRecords,
          columns,
          crosstabs,
          sheetNames,
          selectedSheet,
          rawDataRows: validRows
        });

      } catch (err: any) {
        reject(new Error(`فشل في قراءة الملف: ${err.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('حدث خطأ أثناء تحميل الملف من القرص.'));
    };

    reader.readAsArrayBuffer(file);
  });
}

// Structuring group analysis for matching-choices questions
export interface AggregatedGroup {
  choices: string[];
  columns: string[];
  tableData: {
    columnName: string;
    freqs: { [choice: string]: { count: number; percentage: number } };
  }[];
}

// Identify and group questions with identical answer options
export function getAggregatedGroups(columns: ColumnProfile[]): AggregatedGroup[] {
  // Only consider categorical, ordinal, or boolean columns with 2 to 6 options
  const candidates = columns.filter(col => 
    (col.type === 'categorical' || col.type === 'ordinal' || col.type === 'boolean') &&
    col.frequencies.length >= 2 &&
    col.frequencies.length <= 6
  );

  const groupsMap: { [key: string]: string[] } = {};

  candidates.forEach(col => {
    // Normalise and sort choices to identify equivalence groups
    const choices = col.frequencies.map(f => f.value.trim()).sort();
    const key = choices.join('|||');
    if (!groupsMap[key]) {
      groupsMap[key] = [];
    }
    groupsMap[key].push(col.name);
  });

  const results: AggregatedGroup[] = [];

  Object.entries(groupsMap).forEach(([key, colNames]) => {
    if (colNames.length >= 2) {
      const choices = key.split('|||');
      const tableData = colNames.map(colName => {
        const col = columns.find(c => c.name === colName)!;
        const freqs: { [choice: string]: { count: number; percentage: number } } = {};
        
        choices.forEach(choice => {
          const match = col.frequencies.find(f => f.value.trim() === choice);
          freqs[choice] = {
            count: match ? match.count : 0,
            percentage: match ? match.percentage : 0
          };
        });

        return { columnName: colName, freqs };
      });

      results.push({
        choices,
        columns: colNames,
        tableData
      });
    }
  });

  return results;
}

// Export finalized multi-sheet Excel file
export function exportToFinalExcel(
  profile: DatasetProfile,
  report: any
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: الملخص العام والمنهجية
  const summaryData = [
    ['نظام التحليل الإحصائي المتكامل - تقرير البيانات الميدانية النهائي'],
    [],
    ['الملخص العام والمنهجية'],
    ['اسم ملف البيانات الأصلي', profile.fileName],
    ['اسم ورقة العمل المحددة', profile.selectedSheet || 'الأولى (افتراضي)'],
    ['إجمالي السجلات المستلمة', profile.totalRecords],
    ['السجلات الصالحة للتحليل', profile.validRecords],
    ['نسبة البيانات المكتملة', `${((profile.validRecords / profile.totalRecords) * 100).toFixed(2)}%`],
    ['عدد الأعمدة والمتغيرات المضمنة', profile.columns.length],
    [],
    ['الملخص التنفيذي:'],
    [report?.executiveSummary || 'لم يتم توليد الملخص التنفيذي بعد.'],
    [],
    ['المنهجية العلمية المتبعة:'],
    [report?.methodology || 'تم استبعاد الحالات الفارغة وغير المكتملة تلقائياً لضمان موثوقية العينة.']
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, ws1, 'الملخص والمنهجية');

  // Sheet 2: إحصاءات وصفية وتوزيعات كاملة
  const descriptiveRows: any[] = [
    ['الإحصاء الوصفي وتوزيع التكرارات الكامل للمتغيرات والأعمدة'],
    []
  ];

  profile.columns.forEach(col => {
    descriptiveRows.push([`المتغير: ${col.name}`, `النوع: ${col.type}`, `عدد الاستجابات: ${col.validCount}`, `البيانات المفقودة: ${col.missingCount} (${col.missingPercentage}%)`]);
    if (col.mean !== undefined) {
      descriptiveRows.push(['المتوسط الحسابي', col.mean, 'الانحراف المعياري', col.stdDev, 'الحد الأدنى', col.min, 'الحد الأقصى', col.max]);
    }
    descriptiveRows.push(['الفئة / الخيار', 'التكرار (العدد)', 'النسبة المئوية (%)']);
    col.frequencies.forEach(f => {
      descriptiveRows.push([f.value, f.count, `${f.percentage}%`]);
    });
    descriptiveRows.push([]); // blank row
  });

  const ws2 = XLSX.utils.aoa_to_sheet(descriptiveRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'الإحصاء الوصفي والتوزيعات');

  // NEW Sheet 3: الرسوم والبيانات التفاعلية
  const getArabicType = (type: string): string => {
    switch (type) {
      case 'demographic': return 'ديموغرافي / تعريفي';
      case 'categorical': return 'فئات / تصنيفي';
      case 'ordinal': return 'ترتيبي / مقياس';
      case 'boolean': return 'ثنائي (نعم/لا)';
      case 'numerical': return 'كمّي / رقمي';
      default: return 'نصّي عام';
    }
  };

  const interactiveRows: any[] = [
    ['', 'الرسوم والبيانات التفاعلية الذكية للمتغيرات والأعمدة (توزيع التكرارات والنسب)'],
    ['', 'ملاحظة: الرسوم أدناه تفاعلية تعتمد على صيغة REPT في Excel. عند تعديل قيم التكرارات أو النسب، يتم تحديث الأشرطة البيانية تلقائياً!'],
    []
  ];

  profile.columns.forEach(col => {
    // We only process columns that are not simple 'text' and have frequency entries
    if (col.type !== 'text' && col.frequencies && col.frequencies.length > 0) {
      // Add variable title block
      interactiveRows.push([
        '', // Col A spacer
        `المتغير: ${col.name}`,
        `النوع: ${getArabicType(col.type)}`,
        `عدد الاستجابات الصالحة: ${col.validCount}`,
        'الرسم البياني التفاعلي (مخطط شريطي تكراري)'
      ]);

      // Headers row
      interactiveRows.push([
        '', // Col A spacer
        'الفئة / الخيار',
        'التكرار (العدد)',
        'النسبة المئوية (%)',
        'مخطط التوزيع التكراري (تحديث فوري)'
      ]);

      const startExcelRow = interactiveRows.length + 1;
      
      col.frequencies.forEach(f => {
        const optionExcelRow = interactiveRows.length + 1;
        interactiveRows.push([
          '', // Col A spacer
          { v: f.value, t: 's' },
          { v: f.count, t: 'n' },
          { v: f.percentage / 100, t: 'n', z: '0.0%' },
          { f: `REPT("█", ROUND(D${optionExcelRow} * 40, 0))` }
        ]);
      });

      const endExcelRow = interactiveRows.length;

      // Add Total Row
      const totalExcelRow = interactiveRows.length + 1;
      interactiveRows.push([
        '', // Col A spacer
        'الإجمالي',
        { f: `SUM(C${startExcelRow}:C${endExcelRow})`, t: 'n' },
        { f: `SUM(D${startExcelRow}:D${endExcelRow})`, t: 'n', z: '0.0%' },
        { f: `REPT("█", ROUND(D${totalExcelRow} * 40, 0))` }
      ]);

      // Add 2 empty spacing rows
      interactiveRows.push([]);
      interactiveRows.push([]);
    }
  });

  const wsInteractive = XLSX.utils.aoa_to_sheet(interactiveRows);

  // Set widths for Columns in the interactive sheet
  wsInteractive['!cols'] = [
    { wch: 3 },  // Column A: Spacer
    { wch: 35 }, // Column B: Category / Option
    { wch: 15 }, // Column C: Frequency
    { wch: 15 }, // Column D: Percentage
    { wch: 45 }  // Column E: Interactive Bar Chart (Wide)
  ];

  XLSX.utils.book_append_sheet(wb, wsInteractive, 'الرسوم والبيانات التفاعلية');

  // Sheet 3: علاقات المتغيرات والتحليل المقارن
  const relationRows: any[] = [
    ['تحليل علاقات المتغيرات والتباين المتقاطع (Crosstabulations)'],
    []
  ];

  profile.crosstabs.forEach(ct => {
    relationRows.push([`تحليل مقارنة وتأثير: "${ct.rowVar}" حسب فئات "${ct.colVar}"`]);
    relationRows.push([`قوة العلاقة`, ct.relationshipStrength === 'strong' ? 'قوية جداً' : ct.relationshipStrength === 'moderate' ? 'متوسطة' : 'ضعيفة']);
    relationRows.push([`طبيعة الاتجاه`, ct.relationshipType === 'direct' ? 'طردي' : ct.relationshipType === 'inverse' ? 'عكسي' : 'متداخل/معقد']);
    
    // Matrix Table Header
    const tableHeader = ['', ...ct.colValues];
    relationRows.push(tableHeader);

    ct.rowValues.forEach(r => {
      const rowCells = [r];
      ct.colValues.forEach(c => {
        const cell = ct.matrix[r]?.[c];
        rowCells.push(cell ? `${cell.percentage}% (${cell.count})` : '0% (0)');
      });
      relationRows.push(rowCells);
    });

    relationRows.push(['التحليل التفسيري المستخلص:']);
    relationRows.push([ct.insight]);
    relationRows.push([]); // separator
  });

  const ws3 = XLSX.utils.aoa_to_sheet(relationRows);
  XLSX.utils.book_append_sheet(wb, ws3, 'العلاقات والتحليل المقارن');

  // NEW Sheet 4: احصائيات تجميعية (Aggregated Statistics for similar-choices questions)
  const aggregatedGroups = getAggregatedGroups(profile.columns);
  const aggRows: any[] = [
    ['جداول الإحصائيات التجميعية والأسئلة ذات الإجابات المتشابهة (مثال: مقاييس ليكرت والخيارات المتطابقة)'],
    [],
    ['تم اكتشاف ومقارنة مجموعات الأسئلة المتشابهة لتمكين المقارنة المباشرة للأرقام والنسب المئوية:'],
    []
  ];

  if (aggregatedGroups.length > 0) {
    aggregatedGroups.forEach((group, index) => {
      aggRows.push([`المجموعة التجميعية #${index + 1}: أسئلة ذات خيارات [ ${group.choices.join(' ، ')} ]`]);
      
      // Table Header: columnName and choices
      aggRows.push(['السؤال / المتغير الميداني', ...group.choices]);
      
      group.tableData.forEach(row => {
        const cells = [row.columnName];
        group.choices.forEach(choice => {
          const stats = row.freqs[choice];
          cells.push(`${stats.percentage}% (${stats.count})`);
        });
        aggRows.push(cells);
      });
      
      aggRows.push([]); // blank spacing row
    });
  } else {
    aggRows.push(['لم يتم العثور على مجموعات أسئلة تحتوي على خيارات إجابة متطابقة بالكامل في هذا الملف.']);
    aggRows.push(['توضيح: يتطلب إنشاء هذه المجموعات وجود متغيرين أو أكثر يتشاركون في نفس مجموعة الإجابات الإقصائية تماماً (مثل: موافق/محايد/معترض أو نعم/لا).']);
  }

  const wsAgg = XLSX.utils.aoa_to_sheet(aggRows);
  XLSX.utils.book_append_sheet(wb, wsAgg, 'إحصائيات تجميعية');

  // Sheet 5: الرسوم البيانية والأدلة
  const chartRows = [
    ['دليل الرسوم البيانية التفاعلية وجداول البيانات المضمنة'],
    [],
    ['تم استخلاص الرسوم التالية مع جداول البيانات المصاحبة لها في الواجهة التفاعلية:'],
    ['نوع الرسم المعتمد', 'اسم المتغير المستهدف', 'الغرض والهدف الإحصائي'],
  ];

  profile.columns.forEach(col => {
    if (col.type === 'demographic' || col.type === 'boolean' || (col.type === 'categorical' && col.frequencies.length <= 6)) {
      chartRows.push(['مخطط دائري (Pie Chart)', col.name, `تمثيل توزيع النسب لخيارات "${col.name}" وتوزيع تكراره العام.`]);
    } else if (col.type === 'ordinal' || col.type === 'numerical' || col.frequencies.length > 5) {
      chartRows.push(['مخطط شريطي (Bar Chart)', col.name, `مقارنة الحجم والتكرارات التنازلية المباشرة لـ "${col.name}".`]);
    }
  });

  profile.crosstabs.forEach(ct => {
    chartRows.push(['مخطط مكدس (Stacked Bar Chart)', `${ct.rowVar} حسب ${ct.colVar}`, `مقارنة تباين النسب المئوية المشتركة وعلاقات التداخل الميدانية.`]);
  });

  const ws4 = XLSX.utils.aoa_to_sheet(chartRows);
  XLSX.utils.book_append_sheet(wb, ws4, 'دليل الرسوم والمرئيات');

  // Sheet 6: الاستنتاجات والتوصيات المباشرة
  const conclusionData = [
    ['الاستنتاجات والتوصيات النهائية المباشرة للقرارات الميدانية'],
    [],
    ['أولاً: التحليل الوصفي العام والنتائج التفسيرية'],
    [report?.detailedInsights || 'أظهرت البيانات تفوق الفئات والترددات المبينة في الصفحة الثانية.'],
    [],
    ['ثانياً: تحليل الترابط والتباين الديموغرافي والمقاطع'],
    [report?.relationshipsAnalysis || 'توجد تباينات لافتة في الاحتياجات والتصنيفات تتبع النوع والموقع الجغرافي للمبحوثين.'],
    [],
    ['ثالثاً: التوصيات الميدانية والتدخلات المقترحة المستخلصة من البيانات الميدانية والأرقام'],
    [report?.conclusionsAndRecommendations || 'يوصى بتسريع وتيرة المساعدة للفئات الأشد تضرراً أو احتياجاً طبقاً للإحصاءات الفردية والمقارنة المرصودة.']
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(conclusionData);
  XLSX.utils.book_append_sheet(wb, ws5, 'الاستنتاجات والتوصيات');

  // Trigger download
  XLSX.writeFile(wb, `التقرير_الإحصائي_النهائي_${profile.fileName.split('.')[0]}.xlsx`);
}
