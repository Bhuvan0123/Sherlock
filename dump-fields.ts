import { config } from 'dotenv';
config();
import { AzureDevOpsReadClient } from './src/services/azure-devops/client.js';

async function main() {
    const client = new AzureDevOpsReadClient();
    try {
        const fields = await client.getFields('K4K');
        const dateFields = fields.filter(f => f.type === 'dateTime' || f.name.toLowerCase().includes('date') || f.name.toLowerCase().includes('start') || f.name.toLowerCase().includes('end') || f.name.toLowerCase().includes('finish'));
        
        console.log(JSON.stringify(dateFields.map(f => ({ ref: f.referenceName, name: f.name, type: f.type })), null, 2));
    } catch (err) {
        console.error(err);
    }
}

main();
