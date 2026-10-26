const { processFiles } = require('../metadata');

const docTypes = {
    readme: ['README.md', 'README.txt'],
    citation: ['CITATION.md', 'CITATION.cff'],
};

const blob = (name) => ({ name, type: 'blob' });

describe('processFiles', () => {
    it('builds URLs against HEAD so they resolve on any default branch', () => {
        const [file] = processFiles([blob('README.md')], 'lh3', 'bwa', docTypes);

        expect(file).toEqual({
            type: 'readme',
            url: 'https://github.com/lh3/bwa/blob/HEAD/README.md',
        });
    });

    it('includes the directory in the URL path', () => {
        const [file] = processFiles([blob('README.md')], 'lh3', 'bwa', docTypes, 'docs');

        expect(file.url).toBe('https://github.com/lh3/bwa/blob/HEAD/docs/README.md');
    });

    it('matches known documentation filenames case-insensitively', () => {
        const [file] = processFiles([blob('readme.md')], 'owner', 'repo', docTypes);

        expect(file.type).toBe('readme');
    });

    it('labels unknown documentation files as unclassified, not by directory', () => {
        const root = processFiles([blob('NOTES.md')], 'owner', 'repo', docTypes);
        const nested = processFiles([blob('NOTES.md')], 'owner', 'repo', docTypes, 'example');

        expect(root[0].type).toBe('unclassified');
        expect(nested[0].type).toBe('unclassified');
    });

    it('keeps only markdown and text blobs', () => {
        const files = processFiles(
            [blob('README.md'), blob('NOTES.txt'), blob('main.c'), { name: 'docs', type: 'tree' }],
            'owner',
            'repo',
            docTypes
        );

        expect(files.map(f => f.url)).toEqual([
            'https://github.com/owner/repo/blob/HEAD/README.md',
            'https://github.com/owner/repo/blob/HEAD/NOTES.txt',
        ]);
    });
});
