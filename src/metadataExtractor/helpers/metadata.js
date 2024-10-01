const parse = require("bibtex-parser");
var info = require('debug')('node-api:info');
var error = require('debug')('node-api:error');
const yaml = require('js-yaml');


/**
 * Queries the GitHub API to retrieve metadata about a repository.
 *
 * @param {Octokit} octokit - The Octokit instance used to make API requests.
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @param {number} commitLimit - The maximum number of commits to retrieve.
 * @returns {Promise<Object>} - A promise that resolves to the repository metadata.
 * 
 * @see https://docs.github.com/en/graphql/overview/explorer
 */
async function queryRepositoryObject(octokit, owner, repo, commitLimit) {
    
    const { repository } = await octokit.graphql(
        `
        query ($owner: String!, $repo: String!, $commitLimit: Int!) {    
            repository(owner: $owner, name: $repo) {
            description
            descriptionHTML
            homepageUrl
            isDisabled
            isEmpty
            isFork
            isInOrganization
            isLocked
            isMirror
            isPrivate
            isTemplate
            latestRelease {
                name
                tagName
            }
            licenseInfo {
                id
                name
                spdxId
                url
            }
            name
            mirrorUrl
            packages(first: $commitLimit) {
                nodes {
                    id
                    name
                    packageType
                    version(version: "") {
                    version
                    summary
                    }
                }
            }
            releases(last: $commitLimit) {
                nodes {
                    id
                    tagName
                    name
                    url
                }
            }
            url
            defaultBranchRef {
                target {
                    ... on Commit {
                        history(first: $commitLimit) {
                            edges {
                                node {
                                    author {
                                        name
                                        email
                                        user {
                                            login
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            repositoryTopics(first: $commitLimit) {
                nodes {
                url
                topic {
                    id
                    name
                }
                }
            }
            }
        }
    `,
    {
        owner: owner,
        repo: repo,
        commitLimit: commitLimit
    }
    );

    return repository;

}


/**
 * Removes null values from an array.
 *
 * @param {Array} array - The array from which null values should be removed.
 * @returns {Array} - The array with null values removed.
 */
function removeNull(array) {
 return array.filter(val => val !== null)
}

/**
 * Builds an array of topics based on the license in the GitHub object.
 *  For the license in the github object, generate an item in the topics array
 * {
 *    "vocabulary": "EDAM",
 *    "term": "Topic",
 *    "uri": "http://edamontology.org/topic_0003"
 * }
 *
 * @param {Object} githubObject - The GitHub object containing repository topics in githubObject.repositoryTopics.
 * @returns {Array} - An array of topics.
 */
function buildTopics(githubObject) {
    let topics = [];

    if(githubObject.repositoryTopics.nodes.length > 0){
        githubObject.repositoryTopics.nodes.forEach((node) => {
            var item = {
                uri: node.url,
                term: node.topic.name,
                vocabulary: ''
            }
            topics.push(item);
        });
 }
 
 return topics;
}

/**
 * Builds an array of author objects based on the given GitHub object.
 * 
 * For each collaborator in the github object, generate an object in the authors array
 * {
 *    "name": "John Doe",
 *    "email": "",
 *    "maintainer": "true",
 * }
 *
 * @param {Object} githubObject - The GitHub object containing information about the repository.
 * @returns {Array} - An array of author objects.
 */
function buildAuthors(githubObject) {
    var authors = [];
    
    // Extract contributors from the commit history
    let contributors = githubObject.defaultBranchRef.target.history.edges.map((edge) => edge.node.author); 

    // For each contributor, generate an author object
    contributors.forEach(contributor => {
        const author = {
            name: contributor.name,
            type: 'person',  // GitHub contributor type is always 'person'
            email: contributor.email || '',
            maintainer: false
        };

        // Avoid duplicates based on email
        if (!authors.some(existingAuthor => existingAuthor.email === author.email)) {
            authors.push(author);
        }
    });
    
    return authors;
}


// ------------------------------------------ we are here ----------------------------------------------


function buildLicense(githubObject) {
 /*
 For each license in the github object, generate an object in the license array
 {
     "name": "MIT License",
     "url" : "https://opensource.org/licenses/MIT",
 }
 */
 if(githubObject.licenseInfo){
     var licenses = [{
         name: githubObject.licenseInfo.name,
         url: githubObject.licenseInfo.url
     }]
 }else{
     var licenses = [];
 }
 return licenses;
}

function githubMetadata(ghObject) {
 const meta = {
     name: ghObject.name,
     label: [
         ghObject.name
     ],
     description: removeNull([ 
         ghObject.description 
     ]),
     links: removeNull([
         ghObject.mirrorUrl 
     ]),
     webpage: removeNull([
         ghObject.homepageUrl
     ]),
     isDisabled: ghObject.isDisabled,
     isEmpty: ghObject.isEmpty,
     isLocked: ghObject.isLocked,
     isPrivate: ghObject.isPrivate,
     isTemplate: ghObject.isTemplate,
     version: ghObject.releases.nodes.map((node) => node.tagName),
     license: buildLicense(ghObject),
     repository: removeNull([ 
         ghObject.url
     ]),
     
     topics: buildTopics(ghObject),
     operations: [],
     authors: buildAuthors(ghObject),
     bioschemas: false,
     contribPolicy: [],
     dependencies: [],
     documentation: [],
     download: [], // This could be package or come from repository contents
     edam_operations: [],
     edam_topics: [],
     https: true,
     input: [],
     inst_instr: false,
     operational: false,
     os: [],
     output: [],
     publication: [],
     semantics: {
         inputs: [],
         outputs: [],
         topics: [],
         operations: [],
     },
     source: ['github'],
     src: [],
     ssl: true,
     tags: [],
     test: [],
     type: "",   
 }

 return meta;
}

function PrepareListsIds(metadata) {
 /*
 For each field in the metadata, if it is a list, add an id to each item in the list
 From:
 [
     term1,
     term2,
     ...
 ]
 To:
 [
     { term: term1, id: id1 },
     { term: term2, id: id2 },
     ...
 ]
 */
 const fields = [
     'edam_topics',
     'edam_operations',
     'documentation',
     'description',
     'webpage',
     'license',
     'src',
     'links',
     'topics',
     'operations',
     'input',
     'output',
     'repository',
     'dependencies',
     'os',
     'authors',
     'publication',
 ]
 
 for (const field of fields) {
     var n=0;
     new_field = []
     for (var item of metadata[field]) {
         new_field.push({
             term: item,
             id: n
         });
         n++;
     };
     metadata[field] = new_field;
 }
 return metadata;
}

async function getRepositoryMetadata(octokit, owner, repo) {
 // Use the Explorer to build the GraphQL query: https://docs.github.com/en/graphql/overview/explorer
 const repository = await queryRepositoryObject(octokit, owner, repo, 100);
 info('Repository object retrieved. Transforming to metadata')
 var metadata = githubMetadata(repository); // transform data to the observatory metadata schema
 info('Metadata transformed. Returning metadata')
 return metadata;
}


async function fetchDocumentationFiles(octokit, owner, repo) {
    const docDirs = ['docs', 'documentation', 'example'];
    const docTypes = {
        'readme': ['README.md', 'README.txt'],
        'contributing': ['CONTRIBUTING.md', 'CONTRIBUTING.txt'],
        'license': ['LICENSE.md', 'LICENSE.txt', 'LICENSE'],
        'code_of_conduct': ['CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT.txt'],
        'changelog': ['CHANGELOG.md', 'CHANGELOG.txt'],
        'installation': ['INSTALL.md', 'INSTALL.txt', 'INSTALL'],
        'usage': ['USAGE.md', 'USAGE.txt', 'USAGE'],
        'api': ['API.md', 'API.txt', 'API'],
        'faq': ['FAQ.md', 'FAQ.txt', 'FAQ'],
        'tutorial': ['TUTORIAL.md', 'TUTORIAL.txt', 'TUTORIAL'],
        'requirements': ['REQUIREMENTS.md', 'REQUIREMENTS.txt', 'REQUIREMENTS'],
        'citation': ['CITATION.md', 'CITATION.txt', 'CITATION', 'CITATION.cff'],
    };

    let documentationFiles = [];

    // Fetch root directory contents using GraphQL
    const rootFiles = await fetchDirectoryContentsGraphQL(octokit, owner, repo, '');
    documentationFiles = documentationFiles.concat(processFiles(rootFiles, owner, repo, docTypes));

    // Check and process the specific directories if they exist
    for (let dir of docDirs) {
        const dirFiles = await fetchDirectoryContentsGraphQL(octokit, owner, repo, dir);
        documentationFiles = documentationFiles.concat(processFiles(dirFiles, owner, repo, docTypes, dir));
    }

    return documentationFiles;
}

async function fetchDirectoryContentsGraphQL(octokit, owner, repo, path) {
    // Helper function to fetch contents of a directory using GraphQL

    const query = `
    query($owner: String!, $repo: String!, $path: String!) {
        repository(owner: $owner, name: $repo) {
            object(expression: $path) {
                ... on Tree {
                    entries {
                        name
                        type
                    }
                }
            }
        }
    }
    `;

    const pathExpression = path ? `HEAD:${path}` : "HEAD:";

    const response = await octokit.graphql(query, {
        owner: owner,
        repo: repo,
        path: pathExpression,
    });

    return response.repository.object ? response.repository.object.entries : [];
}

function processFiles(files, owner, repo, docTypes, dir = '') {
    // Helper function to process files and match against documentation types
    return files
        .filter(file => file.type === 'blob' && (file.name.endsWith('.md') || file.name.endsWith('.txt')))
        .map(file => {
            for (const [type, filenames] of Object.entries(docTypes)) {
                if (filenames.map(f => f.toUpperCase()).includes(file.name.toUpperCase())) {
                    return {
                        type: type,
                        url: `https://github.com/${owner}/${repo}/blob/main/${dir ? dir + '/' : ''}${file.name}`
                    };
                }
            }
            // If not a known type, return as a general documentation file
            return {
                type: `${dir || 'root'}`,
                url: `https://github.com/${owner}/${repo}/blob/main/${dir ? dir + '/' : ''}${file.name}`
            };
        });
}

async function getReadmeContent(octokit, owner, repo) {
    try {
        const query = `
          query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              object(expression: "HEAD:README.md") {
                ... on Blob {
                  text
                }
              }
            }
          }
        `;
  
        
        const result = await octokit.graphql(query, {
          owner: owner,
          repo: repo,
        });
    
        if (result.repository.object) {
          const readmeContent = result.repository.object.text;
          console.log("README found.");
          return readmeContent;
        } else {
          console.log("README not found.");
          return null;
        }
      } catch (error) {
        console.error("Error fetching README:", error);
        return null;
      }
}


// Get citation content
async function getCitationContent(octokit, owner, repo) {
    try {
        const query = `
          query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              object(expression: "HEAD:CITATION.cff") {
                ... on Blob {
                  text
                }
              }
            }
          }
        `;
  
        
        const result = await octokit.graphql(query, {
          owner: owner,
          repo: repo,
        });
    
        if (result.repository.object) {
          const readmeContent = result.repository.object.text;
          console.log("CITATION.cff found.");
          return readmeContent;
        } else {
          console.log("CITATION.cff not found.");
          return null;
        }
      } catch (error) {
        console.error("Error fetching README.cff", error);
        return null;
      }
}

// parse citation content from CITATION.cff and map to metadata
function parseCitationCFF(citationContent, metadata) {
    try {
        // Parse the YAML content from the CITATION.cff file
        const citationData = yaml.load(citationContent);

        // Initialize the metadata object if it doesn't exist
        console.log(citationContent)
        console.log(citationData)

        // Map the citation data to the observatory metadata
        if(citationData.license){
            metadata.license.push({
                name: citationData.license,
                url: ''
            })
        }

        if (citationData.title) {
            metadata.label.push(citationData.title);
        }

        if (citationData.authors.length > 0) {
            metadata.authors = citationData.authors.map(author => ({
                name: `${author['given-names']} ${author['family-names']}`,
                email: '',
                maintainer: false,
                type: 'person'
            }));
        }

        if (citationData.version){
            metadata.version.push(citationData.version);
        }

        if (citationData['preferred-citation']){
            new_pub = {
                title: citationData['preferred-citation'].title || '',
                year: citationData['preferred-citation'].year || '',
                doi: citationData['preferred-citation'].doi || '',
                url: citationData['preferred-citation'].url || '',
            }
            metadata.publication.push(new_pub);
        }
        
        // Return the mapped data
        return metadata;

    } catch (error) {
        // log error 
        console.error('Error parsing CITATION.cff:', error);
        return metadata;
    }
}

function removeDuplicatePublications(publications) {
    const uniquePublications = [];

    // Using a Set to keep track of seen titles or DOIs
    const seen = new Set();

    publications.forEach(publication => {
        // Create a unique identifier based on title and DOI
        const identifier = `${publication.title}-${publication.doi}`;

        // If the identifier hasn't been seen yet, add the publication to the unique list
        if (!seen.has(identifier)) {
            seen.add(identifier);
            uniquePublications.push(publication);
        }
    });

    return uniquePublications;
}


function extractBibTeXEntries(content) {
    content = String(content)
    content = content.replace(/`/g, '');
    const normalizeContent = content => content.normalize('NFKD');
    content = normalizeContent(content);

    console.log(content)

    const startRegex = /@(article|INPROCEEDINGS)\s*{[^,]+,/gi;
    let entries = [];
    let match;

    while ((match = startRegex.exec(content)) !== null) {
        let startIndex = match.index;
        let braceCount = 1; // Start with 1 because we know there's an opening '{' after @article{
        let entry = match[0]; // Start with the matched string

        // Continue from the character after the match
        for (let i = startIndex + match[0].length; i < content.length; i++) {
            const char = content[i];
            entry += char;

            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
            }

            // When all braces are closed, we have found the end of the entry
            if (braceCount === 0) {
                entries.push(entry);
                break;
            }
        }
    }

    if (entries.length > 0) {
        console.log('Extracted BibTeX Entries:', entries);
    } else {
        console.log('No BibTeX entries found.');
    }

    return entries;
}

function cleanBracketsInObject(obj) {
    for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'string') {
            // Check if the value starts and ends with curly braces
            if (obj[key].startsWith('{') && obj[key].endsWith('}')) {
                // Remove the curly braces
                obj[key] = obj[key].slice(1, -1).trim();
            }
        }
    }
    return obj;
}

function extractJournalPublication(content) {
    const bibtexEntries = extractBibTeXEntries(content);
    let publications = [];

    for (const entry of bibtexEntries) {
        try {
            const parsed = parse(entry);

            const key = Object.keys(parsed)[0];
            new_pub = {
                title: parsed[key].TITLE || '',
                year: parsed[key].YEAR || '',
                doi: parsed[key].DOI || '',
                url: parsed[key].URL || '',
            }
            new_pub = cleanBracketsInObject(new_pub);
            publications.push(new_pub);
        } catch (error) {
            console.error('Error parsing BibTeX entry:', error);
        }
    }

    return publications;
}


module.exports = {
    queryRepositoryObject,
    removeNull,
    buildTopics,
    buildAuthors,
    buildLicense,
    githubMetadata,
    PrepareListsIds,
    getRepositoryMetadata,
    fetchDocumentationFiles,
    fetchDirectoryContentsGraphQL,
    processFiles,
    getReadmeContent,
    getCitationContent,
    parseCitationCFF,
    removeDuplicatePublications,
    extractBibTeXEntries,
    cleanBracketsInObject,
    extractJournalPublication
};