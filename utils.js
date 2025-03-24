// Utility functions
const str2params = (str) => str.match(/\\?.|^$/g).reduce((p, c) => {
    if (c === '"') {
        p.quote ^= 1;
    } else if (!p.quote && c === ' ') {
        p.a.push('');
    } else {
        p.a[p.a.length - 1] += c.replace(/\\(.)/, "$1");
    }
    return p;
}, { a: [''] }).a;

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

const textMarkdownNormalize = (text) => text.replace(/(?<!(_|\\))_(?!_)/g, '\\_');

module.exports = {str2params, date2int, date2text, textMarkdownNormalize};