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

const isTrue = (str) => ['1', 'true', 'yes'].indexOf(str.toLowerCase()) >= 0;

const date2int = (date) => (typeof date === 'string' ? Date.parse(date) : (date instanceof Date ? date.getTime() : +date)) || 0;

const date2text = (date) => {
    const int = date2int(date);
    if (!int) return '';
    return new Date(int).toLocaleDateString('uk-UA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
};

const getStatusByAction = (action) => {
    if (action === 'join')    return 'joined';
    if (action === 'pending') return 'pending';
    if (action === 'decline') return 'declined';
}

const textMarkdownNormalize = (text) => text.replace(/(?<!(_|\\))_(?!_)/g, '\\_');

const extractUserTitle = (user, useUserName) => user.username && useUserName !== false ? '@' + user.username : (user.first_name + ' ' + (user.last_name || '')).trim();

Date.prototype.addDays = function(days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
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

module.exports = {
    str2params,
    isTrue,
    date2int,
    date2text,
    textMarkdownNormalize,
    getStatusByAction,
    extractUserTitle
};