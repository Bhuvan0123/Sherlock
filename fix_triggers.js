import fs from 'fs';
const addTrigger = (dir, t) => {
    const f = 'skills/' + dir + '/SKILL.md';
    let content = fs.readFileSync(f, 'utf8');
    const m = content.match(/triggers:\n((?:  - .*\n)+)/);
    if (m) {
        const block = m[1];
        const lines = block.trim().split('\n');
        if (lines.length < 3) {
            lines.push('  - ' + t);
            content = content.replace(m[1], lines.join('\n') + '\n');
            fs.writeFileSync(f, content);
        }
    }
};
addTrigger('delivery-forecast', 'show delivery forecast');
addTrigger('dependency-analysis', 'analyze dependencies');
addTrigger('hierarchy-health-analysis', 'check hierarchy health');
addTrigger('schedule-variance-analysis', 'check schedule variance');
addTrigger('stale-work-analysis', 'find stale work');
