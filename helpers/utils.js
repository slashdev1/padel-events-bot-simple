// Utility functions
const str2params = (str) => str/*.match(/\\?.|^$/g)*/.split('').reduce((p, c) => {
    if (c === '"') {
        p.quote ^= 1;
    } else if (!p.quote && c === ' ') {
        p.a.push('');
    } else {
        p.a[p.a.length - 1] += c.replace(/\\(.)/, "$1");
    }
    return p;
}, { a: [''] }).a;

const parseArgs = (input) => {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === '"') {
        inQuotes = !inQuotes; // Перемикаємо стан "всередині лапок"
        current += char;
        } else if (char === ' ' && !inQuotes) {
        // Якщо пробіл і ми НЕ в лапках — це кінець аргументу
        if (current.length > 0) {
            result.push(current);
            current = "";
        }
        } else {
        // Будь-який інший символ (включаючи пробіли всередині лапок)
        current += char;
        }
    }

    // Додаємо останній назбираний фрагмент
    if (current.length > 0) {
        result.push(current);
    }

    // Обробка умови: якщо параметр починається ТА закінчується на ", прибираємо їх
    return result.map(arg => {
        if (arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2) {
        return arg.substring(1, arg.length - 1);
        }
        return arg;
    });
}

const strBefore = (str, delimiter, fromIndex = 0) => {
    const index = str.indexOf(delimiter, fromIndex);
    if (index === -1) return '';
    return str.substring(0, index);
}

const strAfter = (str, delimiter, fromIndex = 0) => {
    const index = str.indexOf(delimiter, fromIndex);
    if (index === -1) return '';
    return str.substring(index + delimiter.length);
}

const splitWithTail = (str, limit) => {
    const parts = str.split(' ');

    // Якщо частин менше або стільки ж, скільки ліміт — повертаємо як є
    if (parts.length <= limit) return parts;

    // Беремо перші (limit - 1) частин
    const result = parts.slice(0, limit - 1);

    // Все інше склеюємо назад через пробіл і кладемо в останній елемент
    const tail = parts.slice(limit - 1).join(' ');
    result.push(tail);

    return result;
}

/** Function that count occurrences of a substring in a string;
 * @param {String} string               The string
 * @param {String} subString            The sub string to search for
 * @param {Boolean} [allowOverlapping]  Optional. (Default:false)
 *
 * @author Vitim.us https://gist.github.com/victornpb/7736865
 * @see Unit Test https://jsfiddle.net/Victornpb/5axuh96u/
 * @see https://stackoverflow.com/a/7924240/938822
 */
function occurrences(string, subString, allowOverlapping) {

    string += "";
    subString += "";
    if (subString.length <= 0) return (string.length + 1);

    var n = 0,
        pos = 0,
        step = allowOverlapping ? 1 : subString.length;

    while (true) {
        pos = string.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        } else break;
    }
    return n;
}

const isTrue = (str) => ['1', 'true', 'yes'].indexOf(str.toLowerCase()) >= 0;
const isFalse = (str) => !isTrue(str);


const isNumeric = (input) => {
    return typeof input === 'number' || !Number.isNaN(Number(input));
}

const convertTZ = (date, tzString) => {
    return new Date((typeof date === 'string' || typeof date === 'number' ? new Date(date) : date).toLocaleString('en-US', { timeZone: tzString }));
}

const formatToTimeZone = (date, timeZone) => {
    return new Intl.DateTimeFormat('uk-UA', {
        timeZone: timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false // формат 24г
    }).format(date).replace(',', ''); // Прибираємо кому, якщо вона з'явиться
}

const parseDate = (str, timezoneOrOffset) => {
    let stringDate = str;
    let parsedDate = Date.parse(stringDate);
    const partsDate = stringDate.match(/\d+/g);
    if (!parsedDate && partsDate && partsDate.length >= 4 && stringDate.indexOf(':') == -1) {
        // allowed type date without last ":"
        // Date.parse('2025.03.01.9:') - unpredictably its correct format, also those are Date.parse('2025/03/01/9:') Date.parse('2025 03 01 9:')
        // but not Date.parse('2025-03-01-9:')
        if (partsDate.length === 4) stringDate = `${partsDate[0]}-${partsDate[1]}-${partsDate[2]} ${partsDate[3]}:`;
        if (partsDate.length === 5) stringDate = `${partsDate[0]}-${partsDate[1]}-${partsDate[2]} ${partsDate[3]}:${partsDate[4]}`;
        parsedDate = Date.parse(stringDate);
    }
    if (parsedDate !== NaN) parsedDate = normalizeParsedDate(parsedDate, timezoneOrOffset);
    return parsedDate;
}

const normalizeParsedDate = (parsedDate, timezoneOrOffset) => {
    if (isNumeric(timezoneOrOffset)) return parsedDate + 60000 * (+timezoneOrOffset - new Date().getTimezoneOffset());
    return convertTZ(parsedDate, timezoneOrOffset).getTime();
}

const getStatusByAction = (action) => {
    if (action === 'join')    return 'joined';
    if (action === 'pending') return 'pending';
    if (action === 'decline') return 'declined';
}

const textMarkdownNormalize = (text) => text.replace(/(?<!(_|\\))_(?!_)/g, '\\_');

const extractUserTitle = (user, useUserName) => user.username && useUserName !== false ? '@' + user.username : (user.first_name + ' ' + (user.last_name || '')).trim();

const matchGameTimeInText = (str) => {
    if (!str || typeof str !== 'string') return null;
    const divider = /\s*[-—–]\s*/.source;
    // Дозволяємо обом частинам (початку і кінцю) бути без хвилин; або одиночний HH:MM
    const regex = new RegExp(`(\\d{1,2}(?::\\d{2})?)${divider}(\\d{1,2}(?::\\d{2})?)|(\\d{1,2}:\\d{2})`);
    return regex.exec(str);
};

/** Нормалізує фрагмент часу з назви гри до рядка HH:MM (24h). */
const normalizeGameTimePart = (part) => {
    if (part == null || part === '') return null;
    let t = String(part).trim();
    let h;
    let m;
    if (t.includes(':')) {
        [h, m = '00'] = t.split(':');
    } else {
        h = t;
        m = '00';
    }
    const hh = Math.min(23, Math.max(0, parseInt(h, 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m, 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/**
 * З тексту назви підігри: діапазон "10-12", "10:00—11:30" або один час "14:00".
 * @returns {{ start: string, end: string | null } | null} start/end як HH:MM; end === null якщо в тексті лише один момент часу
 */
const extractTimeRangeFromText = (str) => {
    const match = matchGameTimeInText(str);
    if (!match) return null;
    if (match[1] != null && match[2] != null && match[2] !== '') {
        return { start: normalizeGameTimePart(match[1]), end: normalizeGameTimePart(match[2]) };
    }
    if (match[3]) {
        return { start: normalizeGameTimePart(match[3]), end: null };
    }
    return null;
};

const extractStartTime = (str) => {
    const match = matchGameTimeInText(str);
    if (!match) return null;
    if (match[1]) {
        let start = match[1];
        return start.includes(':') ? start : `${start}:00`;
    }
    return match[3] || null;
};

function parseDateFromString(text) {
    // Регулярний вираз:
    // \d{1,2}     - 1 або 2 цифри для дня
    // [.\-/]      - роздільник: крапка, дефіс або слеш
    // \d{1,2}     - 1 або 2 цифри для місяця
    // [.\-/]      - той самий набір роздільників
    // \d{2,4}     - від 2 до 4 цифр для року
    const dateRegex = /\b(\d{1,2})[\.\-/](\d{1,2})[\.\-/](\d{2,4})\b/g;

    let matches = [...text.matchAll(dateRegex)];

    if (matches.length > 0) {
        return matches.map(match => ({
            fullDate: match[0],
            day: match[1],
            month: match[2],
            year: match[3]
        }));
    }

    // Если не найдено, ищем строго dd.mm (например 1.04, 22.04, 31.11)
    const dateRegexShort = /\b(\d{1,2})\.(\d{1,2})\b/g;

    matches = [...text.matchAll(dateRegexShort)].filter(match => +match[1] <= 31 && +match[2] <= 12);
    const currentYear = new Date().getFullYear();

    return matches.map(match => ({
        fullDate: `${match[0]}.${currentYear}`, // добавляем год к строке
        day: match[1],
        month: match[2],
        year: String(currentYear)
    }));
}

const extractDate = (str) => {
    const dates = parseDateFromString(str);
    return dates.length ? (+dates[0].year < 2000 ? String(+dates[0].year + 2000) : dates[0].year) + '.' + dates[0].month + '.' + dates[0].day : null;
}

// const parseDateWithTimezone = (text, timezone = 'Europe/Kyiv') => {
//     const input = text.toLowerCase();

//     // 1. Отримуємо поточний час саме у вказаній таймзоні
//     const nowInTZ = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
//     const currentDay = nowInTZ.getDay(); // 0 (нд) - 6 (сб)

//     const daysMap = {
//         0: ['неділя', 'воскресенье', 'неділю', '(^|\\s|[,.])(нд|вс)($|\\s|[,.])'],
//         1: ['понеділок', 'понедельник', '(^|\\s|[,.])(пн)($|\\s|[,.])'],
//         2: ['вівторок', 'вторник', '(^|\\s|[,.])(вт)($|\\s|[,.])'],
//         3: ['середа', 'среда', 'середу', 'среду', '(^|\\s|[,.])(ср)($|\\s|[,.])'],
//         4: ['четвер', 'четверг', '(^|\\s|[,.])(чт)($|\\s|[,.])'],
//         5: ['п’ятниця', 'п’ятницю', 'пʼятниця', 'пʼятницю', 'пятница', 'пятницу', '(^|\\s|[,.])(пт)($|\\s|[,.])'],
//         6: ['субота', 'суббота', 'суботу', 'субботу', '(^|\\s|[,.])(сб)($|\\s|[,.])']
//     };

//     let targetDate = new Date(nowInTZ);

//     // 2. Логіка "сьогодні / завтра"
//     if (/(сьогодні|сегодня)/.test(input)) {
//         // Залишаємо targetDate як є (сьогодні)
//     } else if (/(завтра)/.test(input)) {
//         targetDate.setDate(nowInTZ.getDate() + 1);
//     } else {
//         // 3. Пошук дня тижня
//         let foundDay = null;
//         for (let dayIndex in daysMap) {
//             const variants = daysMap[dayIndex];
//             const regex = new RegExp(`(${variants.join('|')})`, 'i');
//             if (regex.test(input)) {
//                 foundDay = parseInt(dayIndex);
//                 break;
//             }
//         }

//         if (foundDay !== null) {
//             // Рахуємо різницю днів
//             let daysDiff = (foundDay - currentDay + 7) % 7 || 7;

//             // Якщо сьогодні субота і людина пише "субота", зазвичай це сьогодні.
//             // Але якщо ти хочеш, щоб "субота" в суботу означала "наступна субота",
//             // заміни умови нижче.
//             targetDate.setDate(nowInTZ.getDate() + daysDiff);
//         } else {
//             return null; // Дату не розпізнано
//         }
//     }

//     // Повертаємо чисту дату (рік-місяць-день) без залишків старого часу
//     //return targetDate.getDate().toISOString().split('T')[0];
//     return targetDate.getFullYear() + '-' + String(targetDate.getMonth() + 1).padStart(2, '0') + '-' + String(targetDate.getDate()).padStart(2, '0')
// }
const parseDateWithTimezone = (text, timezone = 'Europe/Kyiv') => {
    const input = text.toLowerCase();

    // 1. Отримуємо точний час у цільовій зоні через форматтер
    const now = new Date();
    const tzString = now.toLocaleString('en-US', { timeZone: timezone });
    const targetNow = new Date(tzString);

    // Отримуємо компоненти саме для цієї часової зони
    const currentYear = targetNow.getFullYear();
    const currentMonth = targetNow.getMonth();
    const currentDate = targetNow.getDate();
    const currentDay = targetNow.getDay(); // 0-6

    // Створюємо об'єкт дати, виставлений на "сьогодні 00:00" за часом зони
    let targetDate = new Date(currentYear, currentMonth, currentDate);

    const daysMap = {
        0: ['неділя', 'воскресенье', 'неділю', '(^|\\s|[,.])(нд|вс)($|\\s|[,.])'],
        1: ['понеділок', 'понедельник', '(^|\\s|[,.])(пн)($|\\s|[,.])'],
        2: ['вівторок', 'вторник', '(^|\\s|[,.])(вт)($|\\s|[,.])'],
        3: ['середа', 'среда', 'середу', 'среду', '(^|\\s|[,.])(ср)($|\\s|[,.])'],
        4: ['четвер', 'четверг', '(^|\\s|[,.])(чт)($|\\s|[,.])'],
        5: ['п’ятниця', 'п’ятницю', 'пʼятниця', 'пʼятницю', 'п\'ятниця', 'п\'ятницю', 'пятница', 'пятницу', '(^|\\s|[,.])(пт)($|\\s|[,.])'],
        6: ['субота', 'суббота', 'суботу', 'субботу', '(^|\\s|[,.])(сб)($|\\s|[,.])']
    };

    if (/(сьогодні|сегодня)/.test(input)) {
        // Вже встановлено на сьогодні
    } else if (/(завтра)/.test(input)) {
        targetDate.setDate(targetDate.getDate() + 1);
    } else {
        let foundDay = null;
        for (let dayIndex in daysMap) {
            const regex = new RegExp(`(${daysMap[dayIndex].join('|')})`, 'i');
            if (regex.test(input)) {
                foundDay = parseInt(dayIndex);
                break;
            }
        }

        if (foundDay !== null) {
            // Математика: якщо сьогодні четвер і просять "четвер" — це +7 днів.
            let daysDiff = (foundDay - currentDay + 7) % 7 || 7;
            targetDate.setDate(targetDate.getDate() + daysDiff);
        } else {
            return null;
        }
    }

    // Ручне форматування YYYY-MM-DD, щоб уникнути впливу часових поясів .toISOString()
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
}

const extractPlayers = (input) => {
    // Шукаємо число, за яким йдуть варіації слова "гравці"
    const regex = /(\d+)\s*(грав|игрок|люд|челов|учасни)/i;
    const match = input.match(regex);

    if (match) {
        return parseInt(match[1], 10); // match[1] — це саме число
    }

    // Якщо специфічних слів немає, можна шукати просто будь-яке число
    // (але це ризиковано, бо може збігтися з часом 14-16)
    return null;
}

// Допоміжна функція для безпечного підрахунку груп з цифр у рядку
const getDigitGroupCount = (str) => (str?.match(/\d+/g) || []).length;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isDate = (date) => date instanceof Date && !isNaN(date);

const arraysEqualUnordered = (a1, a2) => {
    if (a1.length !== a2.length) return false;
    const s1 = a1.map(o => JSON.stringify(o)).sort();
    const s2 = a2.map(o => JSON.stringify(o)).sort();
    return s1.every((val, i) => val === s2[i]);
}

const truncateString = (str, maxLength) => {
    if (str.length <= maxLength) {
        return str; // если строка короче или равна лимиту, возвращаем её целиком
    }
    return str.slice(0, maxLength) + '...'; // иначе обрезаем и добавляем "..."
}

const unescapeString = (str) => {
    // Оборачиваем строку в кавычки и парсим как JSON
    return JSON.parse(`"${str}"`);
}

Date.prototype.addDays = function(days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
}

Date.prototype.addMinutes = function(minutes) {
    var date = new Date(this.valueOf());
    date.setMinutes(date.getMinutes() + minutes);
    return date;
}

Date.prototype.startOfDay = function() {
    var date = new Date(this.valueOf());
    date.setUTCHours(0,0,0,0);
    return date;
}

Date.prototype.endOfDay = function() {
    var date = new Date(this.valueOf());
    date.setUTCHours(23,59,59,999);
    return date;
}

Date.prototype.startOfSecond = function() {
    var date = new Date(this.valueOf());
    date.setMilliseconds(0);
    return date;
}

Date.prototype.endOfSecond = function() {
    var date = new Date(this.valueOf());
    date.setMilliseconds(999);
    return date;
}

module.exports = {
    isTrue,
    isFalse,
    isNumeric,
    str2params,
    parseDate,
    textMarkdownNormalize,
    getStatusByAction,
    extractUserTitle,
    occurrences,
    extractStartTime,
    extractTimeRangeFromText,
    extractDate,
    parseDateWithTimezone,
    normalizeParsedDate,
    parseArgs,
    strBefore,
    strAfter,
    splitWithTail,
    extractPlayers,
    getDigitGroupCount,
    sleep,
    formatToTimeZone,
    isDate,
    arraysEqualUnordered,
    truncateString,
    unescapeString
};