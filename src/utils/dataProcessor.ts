import * as XLSX from 'xlsx';
import { DatasetProfile, ColumnProfile, FrequencyItem, CrosstabProfile, CrosstabMatrix, VariableType, OutlierInfo } from '../types';

// Arabic Data Cleaning and Standardization Pipeline
export function cleanArabicText(text: string): string {
  if (!text) return '';
  let str = String(text);

  // 1. Remove Tashkeel (Arabic diacritics) fully
  const tashkeelRegex = /[\u064B-\u0652]/g;
  str = str.replace(tashkeelRegex, '');

  // 2. Remove Tatweel/Kashida (ـ)
  str = str.replace(/\u0640/g, '');

  // 3. Remove punctuation and special symbols
  const punctuationRegex = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~،؛؟«»°•]/g;
  str = str.replace(punctuationRegex, '');

  // 4. Standardize multiple whitespaces
  str = str.trim().replace(/\s+/g, ' ');

  // 5. Basic Normalization:
  // Unify Alefs (أ، إ، آ -> ا)
  str = str.replace(/[أإآ]/g, 'ا');
  // Unify Te Marbuta (ة -> ه)
  str = str.replace(/ة/g, 'ه');
  // Unify Ya and Alef Maksura (ى -> ي)
  str = str.replace(/ى/g, 'ي');

  // 6. Compound names handling (remove spacing inside specific name formats):
  // served/deified names: (عبد، أمة)
  str = str.replace(/\b(عبد|امة|امه)\s+/g, '$1');

  // titles & kunyas: (أبو، أبا، أبي، بن، بنو، بني، ذو، ذا، ذي)
  str = str.replace(/\b(ابو|أبو|ابا|أبا|ابي|أبي|بن|بنو|بني|ذو|ذا|ذي)\s+/g, '$1');

  // other compounds ending in "الدين" (صلاح، سيف، نور، علاء، شمس، عماد، تقي، جاد، بهاء)
  str = str.replace(/\b(صلاح|سيف|نور|علاء|شمس|عماد|تقي|جاد|بهاء)\s+(الدين)\b/g, '$1$2');

  // Re-verify no residual duplicate spaces
  str = str.trim().replace(/\s+/g, ' ');

  return str;
}

export function cleanArabicValue(val: any): any {
  if (val === undefined || val === null) return '';
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val;

  const str = String(val);
  // If it represents a pure number, preserve as number
  if (str.trim() !== '' && !isNaN(Number(str))) {
    return Number(str);
  }

  return cleanArabicText(str);
}

// Statistical Outlier Detection via Interquartile Range (IQR) Method
export function detectOutliers(numbers: number[]): OutlierInfo | null {
  if (numbers.length < 4) return null; // Too few data points to compute IQR reliably

  const sorted = [...numbers].sort((a, b) => a - b);
  
  // Percentile calculation
  const getPercentile = (arr: number[], p: number): number => {
    const index = (arr.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return arr[lower] * (1 - weight) + arr[upper] * weight;
  };

  const q1 = getPercentile(sorted, 0.25);
  const q3 = getPercentile(sorted, 0.75);
  const iqr = q3 - q1;

  if (iqr === 0) return null; // No variability or all values are identical

  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const outliers = numbers.filter(n => n < lowerBound || n > upperBound);
  if (outliers.length === 0) return null;

  const count = outliers.length;
  const percentage = Number(((count / numbers.length) * 100).toFixed(2));

  // Determine skew/impact on central tendency (mean vs clean mean without outliers)
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const nonOutliers = numbers.filter(n => n >= lowerBound && n <= upperBound);
  const cleanMean = nonOutliers.length > 0 
    ? nonOutliers.reduce((a, b) => a + b, 0) / nonOutliers.length 
    : mean;
  
  const meanDiff = Math.abs(mean - cleanMean);
  const pctDiff = cleanMean > 0 ? (meanDiff / cleanMean) * 100 : 0;

  let impactDescription = '';
  let recommendation = '';

  if (pctDiff > 10) {
    impactDescription = `تأثير مرتفع جداً: القيم المتطرفة المكتشفة تزيح المتوسط الحسابي بمقدار ${meanDiff.toFixed(2)} (${pctDiff.toFixed(1)}%)، مما يؤدي لتشوه واضح في التوزيع الإحصائي.`;
    recommendation = 'يوصى باستخدام "الوسيط (Median)" بدلاً من المتوسط الحسابي، أو عزل هذه القيم المتطرفة يدوياً لتجنب الانحياز في التقارير.';
  } else if (pctDiff > 3) {
    impactDescription = `تأثير متوسط: هناك إزاحة طفيفة في المتوسط الحسابي بمقدار ${meanDiff.toFixed(2)} (${pctDiff.toFixed(1)}%) بسبب هذه القيم الاستثنائية.`;
    recommendation = 'يفضل مراجعة السجلات التي تحتوي على هذه القيم للتأكد من أنها ليست أخطاء مادية في الإدخال الميداني.';
  } else {
    impactDescription = 'تأثير منخفض: وجود قيم متطرفة متباعدة لا تؤثر بشكل جوهري على نزعة مركزية العمود الرقمي.';
    recommendation = 'لا يتطلب هذا التباين إجراءً إحصائياً عاجلاً، لكن يفضل الإبقاء عليه قيد الملاحظة.';
  }

  return {
    lowerBound: Number(lowerBound.toFixed(2)),
    upperBound: Number(upperBound.toFixed(2)),
    count,
    percentage,
    values: Array.from(new Set(outliers)).slice(0, 5), // top 5 unique outlier values
    impactDescription,
    recommendation
  };
}

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
      profile.outlierInfo = detectOutliers(numbers);
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

  // Deep relationship and variance checking using Chi-Square and Cramér's V
  let chiSquare = 0;
  const rowTotals: { [key: string]: number } = {};
  const colTotals: { [key: string]: number } = {};
  let grandTotal = 0;

  rowValues.forEach(r => {
    rowTotals[r] = Object.values(matrix[r]).reduce((sum, cell) => sum + cell.count, 0);
    grandTotal += rowTotals[r];
  });

  colValues.forEach(c => {
    let colSum = 0;
    rowValues.forEach(r => {
      colSum += matrix[r][c].count;
    });
    colTotals[c] = colSum;
  });

  if (grandTotal > 0) {
    rowValues.forEach(r => {
      colValues.forEach(c => {
        const observed = matrix[r][c].count;
        const expected = (rowTotals[r] * colTotals[c]) / grandTotal;
        if (expected > 0) {
          chiSquare += Math.pow(observed - expected, 2) / expected;
        }
      });
    });
  }

  const numRows = rowValues.length;
  const numCols = colValues.length;
  const minDim = Math.min(numRows - 1, numCols - 1);
  const cramersV = grandTotal > 0 && minDim > 0
    ? Math.sqrt(chiSquare / (grandTotal * minDim))
    : 0;

  // Map Cramér's V to qualitative relationship strength
  let relationshipStrength: 'strong' | 'moderate' | 'weak' | 'none' = 'none';
  if (cramersV > 0.35) {
    relationshipStrength = 'strong';
  } else if (cramersV > 0.15) {
    relationshipStrength = 'moderate';
  } else if (cramersV > 0.04) {
    relationshipStrength = 'weak';
  }

  // Determine direction or type of relation
  let relationshipType: 'direct' | 'inverse' | 'complex' | 'none' = 'none';
  if (relationshipStrength !== 'none') {
    if ((rowCol.type === 'numerical' || rowCol.type === 'ordinal') && 
        (colCol.type === 'numerical' || colCol.type === 'ordinal')) {
      relationshipType = 'direct'; 
    } else {
      relationshipType = 'complex';
    }
  }

  // Multi-dimensional detailed insight including the exact Cramér's V and Chi-Square
  let insight = '';
  if (rowValues.length > 0 && colValues.length > 0) {
    const topRowVal = rowValues[0];
    const topColVals = colValues.map(c => ({
      value: c,
      pct: matrix[topRowVal][c]?.percentage || 0
    })).sort((a, b) => b.pct - a.pct);

    const topColVal = topColVals[0];
    const strengthAr = relationshipStrength === 'strong' ? 'قوي جداً' : relationshipStrength === 'moderate' ? 'متوسط' : relationshipStrength === 'weak' ? 'محدود' : 'شبه منعدم';
    
    insight = `أظهر اختبار التباين ثنائي الأبعاد (Cramér's V = ${cramersV.toFixed(3)}) وجود ارتباط إحصائي ${strengthAr} بين المتغيرين "${rowVar}" و "${colVar}". للفئة "${topRowVal}"، يتركز الخيار الغالب لـ "${colVar}" عند "${topColVal.value}" بنسبة بلغت ${topColVal.pct.toFixed(1)}% (قيمة مربع كاي = ${chiSquare.toFixed(2)})، مما يدعم معنوية الفروق والتباين الإحصائي للعينات.`;
  } else {
    insight = `لا توجد عينات مشتركة كافية لإجراء فحص الترابط والتباين لمربع كاي بين "${rowVar}" و "${colVar}".`;
  }

  return {
    rowVar,
    colVar,
    matrix,
    rowValues,
    colValues,
    relationshipStrength,
    relationshipType,
    insight,
    cramersV: Number(cramersV.toFixed(4)),
    chiSquare: Number(chiSquare.toFixed(2))
  };
}

function getAgeRange(age: number): string {
  if (isNaN(age) || age < 0) return 'غير حدد';
  if (age <= 5) return 'من 0 إلى 5 سنوات (طفولة مبكرة)';
  if (age <= 12) return 'من 6 إلى 12 سنة (طفولة)';
  if (age <= 17) return 'من 13 إلى 17 سنة (يافعين)';
  if (age <= 23) return 'من 18 إلى 23 سنة (شباب مبكر)';
  if (age <= 35) return 'من 24 إلى 35 سنة (شباب)';
  if (age <= 50) return 'من 36 إلى 50 سنة (كهولة/بالغين)';
  if (age <= 65) return 'من 51 إلى 65 سنة (كبار السن)';
  return 'أكثر من 65 سنة (مسنين)';
}

export function isPersonNamesColumn(name: string, values: any[]): boolean {
  const n = name.toLowerCase();
  const nameKeywords = [
    'اسم', 'الاسم', 'أسم', 'الباحث', 'المستفيد', 'الموظف', 'العميل', 'رئيس', 'رب', 'الأسرة', 'الاسرة', 'العائلة',
    'name', 'employee', 'customer', 'beneficiary', 'researcher', 'surveyor', 'respondent', 'head'
  ];
  const matchesKeyword = nameKeywords.some(k => n.includes(k));
  
  const nonNullValues = values.filter(v => v !== undefined && v !== null && String(v).trim() !== '');
  if (nonNullValues.length === 0) return false;
  
  const uniqueVals = new Set(nonNullValues.map(v => String(v).trim()));
  const cardinalityRatio = uniqueVals.size / nonNullValues.length;
  
  // If a column matches name keywords and has a decent number of unique values, it's a names column.
  if (matchesKeyword && uniqueVals.size > 5) {
    return true;
  }
  if (cardinalityRatio > 0.85 && uniqueVals.size > 15) {
    return true;
  }
  return false;
}

export function isExcludedFromCrosstab(name: string, values: any[]): boolean {
  const n = name.toLowerCase();
  
  // 1. Check if it matches person names
  if (isPersonNamesColumn(name, values)) {
    return true;
  }
  
  // 2. Check for phone numbers
  const phoneKeywords = [
    'هاتف', 'جوال', 'تلفون', 'موبايل', 'رقم', 'واتس', 'اتصال',
    'phone', 'mobile', 'tel', 'whatsapp', 'contact', 'number'
  ];
  const hasPhoneKeyword = phoneKeywords.some(k => n.includes(k)) && !n.includes('عدد') && !n.includes('درجة') && !n.includes('فئة');
  
  const nonNullValues = values.filter(v => v !== undefined && v !== null && String(v).trim() !== '');
  if (nonNullValues.length === 0) return true;
  
  // Sample values
  const sampleValues = nonNullValues.slice(0, 100).map(v => String(v).trim());
  
  // Phone digits pattern: check if values are mostly numeric digits/spaces/dashes of length 7-15
  const phonePatternCount = sampleValues.filter(val => {
    const cleaned = val.replace(/[\s+\-()]/g, '');
    return cleaned.length >= 7 && cleaned.length <= 15 && /^\d+$/.test(cleaned);
  }).length;
  
  if (phonePatternCount / sampleValues.length > 0.6 || (hasPhoneKeyword && phonePatternCount > 0)) {
    return true;
  }
  
  // 3. Check for long texts (average length of values > 25)
  const avgLength = sampleValues.reduce((sum, val) => sum + val.length, 0) / sampleValues.length;
  if (avgLength > 25) {
    return true;
  }
  
  // Check for unique identifier or primary key columns (high unique ratio, e.g. serial numbers, hashes, codes)
  const uniqueVals = new Set(sampleValues);
  if (uniqueVals.size / sampleValues.length > 0.85 && sampleValues.length > 8) {
    return true;
  }
  
  return false;
}

// Main parser to read Excel or CSV and construct profile
export async function processFile(file: File, targetSheetName?: string, removeDuplicates: boolean = false): Promise<DatasetProfile> {
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

        // Optional duplicate removal
        let finalRows = validRows;
        let removedDuplicatesCount = 0;
        if (removeDuplicates) {
          const seen = new Set<string>();
          finalRows = [];
          for (const row of validRows) {
            const serialized = JSON.stringify(Object.keys(row).sort().reduce((acc, k) => {
              const val = row[k] === undefined || row[k] === null ? '' : String(row[k]).trim();
              acc[k] = val;
              return acc;
            }, {} as any));

            if (!seen.has(serialized)) {
              seen.add(serialized);
              finalRows.push(row);
            } else {
              removedDuplicatesCount++;
            }
          }
        }

        const validRecords = finalRows.length;

        // Keep a deep copy of original raw data rows before any cleaning
        const originalRawDataRows = JSON.parse(JSON.stringify(finalRows));

        // Clean all cell values for analysis and standardized display
        const cleanedRows = finalRows.map((row: any) => {
          const cleanedRow: any = {};
          Object.keys(row).forEach(key => {
            cleanedRow[key] = cleanArabicValue(row[key]);
          });
          return cleanedRow;
        });

        // Get headers
        const headers = Object.keys(rows[0]);

        // 1. Identify any age columns that are numerical and qualify for bracketing
        const ageHeadersToBracket: string[] = [];
        headers.forEach(header => {
          const lowerHeader = header.toLowerCase();
          const isAgeName = lowerHeader.includes('عمر') || lowerHeader.includes('العمر') || lowerHeader.includes('السن') || lowerHeader.includes('age');
          const isAlreadyBracket = lowerHeader.includes('فئة') || lowerHeader.includes('نطاق') || lowerHeader.includes('range') || lowerHeader.includes('bracket');
          
          if (isAgeName && !isAlreadyBracket) {
            // Check if values are mostly numerical
            const colValues = cleanedRows.map(row => Number(row[header])).filter(n => !isNaN(n) && n > 0);
            if (colValues.length > 0 && colValues.every(n => n >= 0 && n <= 120)) {
              ageHeadersToBracket.push(header);
            }
          }
        });

        // 2. Add brackets for each identified age column
        ageHeadersToBracket.forEach(header => {
          const bracketHeader = `${header} (نطاقات)`;
          cleanedRows.forEach(row => {
            const ageVal = Number(row[header]);
            if (row[header] !== undefined && row[header] !== null && row[header] !== '' && !isNaN(ageVal)) {
              row[bracketHeader] = getAgeRange(ageVal);
            } else {
              row[bracketHeader] = 'غير محدد';
            }
          });
          if (!headers.includes(bracketHeader)) {
            headers.push(bracketHeader);
          }
        });

        // Build columns profile using cleaned rows
        const columns: ColumnProfile[] = headers.map(header => {
          const colValues = cleanedRows.map(row => row[header]);
          const type = detectVariableType(header, colValues);
          return analyzeColumn(header, colValues, type);
        });

        // Filter out columns containing people's names, phone numbers, or long texts from crosstabs
        const eligibleColumns = columns.filter(col => {
          const colValues = cleanedRows.map(row => row[col.name]);
          return !isExcludedFromCrosstab(col.name, colValues);
        });

        const crosstabs: CrosstabProfile[] = [];

        // Identify candidate variables for relations study
        const relationCandidates = eligibleColumns.filter(c => 
          (c.type === 'demographic' || c.type === 'categorical' || c.type === 'ordinal' || c.type === 'boolean') &&
          c.frequencies.length >= 2 && c.frequencies.length <= 15
        );

        // Prioritize demographic variables to compare against others
        const demoCols = relationCandidates.filter(c => 
          c.type === 'demographic' || 
          c.name.includes('النوع') || c.name.includes('جنس') || 
          c.name.includes('عمر') || c.name.includes('نطاقات') || 
          c.name.includes('منطقة') || c.name.includes('محافظة')
        );
        
        const otherCols = relationCandidates.filter(c => !demoCols.some(dc => dc.name === c.name));

        // 1. Cross match demo variables with other variables (broader and deeper)
        demoCols.forEach(demo => {
          otherCols.forEach(other => {
            if (demo.name !== other.name && crosstabs.length < 24) {
              crosstabs.push(generateCrosstab(other, demo, cleanedRows));
            }
          });
        });

        // 2. Cross match remaining columns amongst themselves to make it extremely comprehensive
        if (crosstabs.length < 15) {
          relationCandidates.forEach(colA => {
            relationCandidates.forEach(colB => {
              if (colA.name !== colB.name && crosstabs.length < 24) {
                if (!crosstabs.some(ct => (ct.rowVar === colA.name && ct.colVar === colB.name) || (ct.rowVar === colB.name && ct.colVar === colA.name))) {
                  crosstabs.push(generateCrosstab(colA, colB, cleanedRows));
                }
              }
            });
          });
        }

        // 3. Fallback to guarantee at least one crosstab from eligible columns
        if (crosstabs.length === 0 && eligibleColumns.length >= 2) {
          const catCols = eligibleColumns.filter(c => c.frequencies.length > 0 && c.frequencies.length <= 12);
          if (catCols.length >= 2) {
            crosstabs.push(generateCrosstab(catCols[0], catCols[1], cleanedRows));
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
          rawDataRows: cleanedRows,
          originalRawDataRows,
          removedDuplicatesCount
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

  // Sheet 7: البيانات المنظفة
  if (profile.rawDataRows && profile.rawDataRows.length > 0) {
    const wsCleaned = XLSX.utils.json_to_sheet(profile.rawDataRows);
    XLSX.utils.book_append_sheet(wb, wsCleaned, 'البيانات المنظفة');
  }

  // Sheet 8: البيانات الأصلية
  if (profile.originalRawDataRows && profile.originalRawDataRows.length > 0) {
    const wsOriginal = XLSX.utils.json_to_sheet(profile.originalRawDataRows);
    XLSX.utils.book_append_sheet(wb, wsOriginal, 'البيانات الأصلية');
  }

  // Trigger download
  XLSX.writeFile(wb, `التقرير_الإحصائي_النهائي_${profile.fileName.split('.')[0]}.xlsx`);
}
