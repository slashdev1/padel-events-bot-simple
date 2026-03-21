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

const strBefore = (str, delimiter) => {
    const index = str.indexOf(delimiter);
    if (index === -1) return '';
    return str.substring(0, index);
}

const strAfter = (str, delimiter) => {
    const index = str.indexOf(delimiter);
    if (index === -1) return '';
    return str.substring(index + delimiter.length);
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

const date2int = (date) => (typeof date === 'string' ? Date.parse(date) : (date instanceof Date ? date.getTime() : +date)) || 0; // deprecated in the nearest future

const date2text = (date) => {
    const int = date2int(date);
    if (!int) return '';
    return new Date(int).toLocaleDateString('uk-UA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
};

const isNumeric = (input) => {
    return typeof input === 'number' || !Number.isNaN(Number(input));
}

const convertTZ = (date, tzString) => {
    return new Date((typeof date === 'string' || typeof date === 'number' ? new Date(date) : date).toLocaleString('en-US', { timeZone: tzString }));
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

const extractStartTime = (str) => {
    const extractTime = (str) => {
        const divider = /\s*[-—–]\s*/.source;
        // Дозволяємо обом частинам (початку і кінцю) бути без хвилин
        const regex = new RegExp(`(\\d{1,2}(?::\\d{2})?)${divider}(\\d{1,2}(?::\\d{2})?)|(\\d{1,2}:\\d{2})`, 'g');

        const match = regex.exec(str);

        if (match) {
            if (match[1]) { // Якщо це діапазон
                let start = match[1];
                // Додаємо :00, якщо хвилин немає
                return start.includes(':') ? start : `${start}:00`;
            }
            return match[0]; // Якщо це одиночний час
        }
        return null;
    }

    return extractTime(str);
}

function parseDateFromString(text) {
    // Регулярний вираз:
    // \d{1,2}     - 1 або 2 цифри для дня
    // [.\-/]      - роздільник: крапка, дефіс або слеш
    // \d{1,2}     - 1 або 2 цифри для місяця
    // [.\-/]      - той самий набір роздільників
    // \d{2,4}     - від 2 до 4 цифр для року
    const dateRegex = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/g;

    const matches = [...text.matchAll(dateRegex)];

    return matches.map(match => {
        return {
            fullDate: match[0],
            day: match[1],
            month: match[2],
            year: match[3]
        };
    });
}

const extractDate = (str) => {
    const dates = parseDateFromString(str);
    return dates.length ? (+dates[0].year < 2000 ? String(+dates[0].year + 2000) : dates[0].year) + '.' + dates[0].month + '.' + dates[0].day : null;
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
    date2int,
    date2text,
    parseDate,
    textMarkdownNormalize,
    getStatusByAction,
    extractUserTitle,
    occurrences,
    extractStartTime,
    extractDate,
    normalizeParsedDate,
    parseArgs,
    strBefore,
    strAfter
};