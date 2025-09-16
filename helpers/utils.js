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

const parseDate = (str) => {
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
    return parsedDate;
};

const getStatusByAction = (action) => {
    if (action === 'join')    return 'joined';
    if (action === 'pending') return 'pending';
    if (action === 'decline') return 'declined';
}

const textMarkdownNormalize = (text) => text.replace(/(?<!(_|\\))_(?!_)/g, '\\_');

const extractUserTitle = (user, useUserName) => user.username && useUserName !== false ? '@' + user.username : (user.first_name + ' ' + (user.last_name || '')).trim();

const extractStartTime = (str) => {
    const extractTime = (str) => {
        const regex = /(\d{1,2}:\d{2})-(\d{1,2}:\d{2})|(\d{1,2}-\d{1,2}:\d{2})|(\d{1,2}:\d{2})/g;
        const matches = str.match(regex);
        if (matches) {
            // Обробка випадку з 7-9:00, де match[0] буде "7-9:00"
            if (matches[0].includes('-') && matches[0].split('-').indexOf(':') === -1) {
            const parts = matches[0].split('-');
            return `${parts[0]}:00-${parts[1]}`;
            }
            return matches.join(' ');
        }
        return null;
    }
    let time = extractTime(str);
    if (!time) return;
    return time.split('-')[0];
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
    str2params,
    date2int,
    date2text,
    parseDate,
    textMarkdownNormalize,
    getStatusByAction,
    extractUserTitle,
    occurrences,
    extractStartTime
};