const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git') && !file.includes('dist')) { 
            results = results.concat(walk(file));
        } else if (file.endsWith('.ts')) {
            results.push(file);
        }
    });
    return results;
}

const rootDir = path.resolve(__dirname);
const srcDir = path.join(rootDir, 'src');
const testsDir = path.join(rootDir, 'tests');

const allFiles = [...walk(srcDir), ...walk(testsDir)];

allFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    if (file.includes(path.join('src', 'azure-devops'))) {
        // Files in src/azure-devops went up one level
        // so ../../ becomes ../
        content = content.replace(/from\s+['"]\.\.\/\.\.\/([^'"]+)['"]/g, "from '../$1'");
    }

    if (!file.includes(path.join('src', 'azure-devops'))) {
        const fileDir = path.dirname(file);
        
        content = content.replace(/from\s+['"]([^'"]+)['"]/g, (match, p1) => {
            if (p1.includes('azure-devops')) {
                const targetDir = path.join(rootDir, 'src', 'azure-devops');
                const parts = p1.split('azure-devops');
                if (parts.length === 2) {
                    const suffix = parts[1]; // /fields.js
                    const targetFile = path.join(targetDir, suffix);
                    let rel = path.relative(fileDir, targetFile).replace(/\\/g, '/');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    return `from '${rel}'`;
                }
            }
            return match;
        });
    }

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Updated ${file}`);
    }
});
