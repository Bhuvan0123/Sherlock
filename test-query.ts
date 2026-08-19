import { WiqlBuilderService } from './src/services/azure-devops/wiql-builder.js';

async function run() {
    const builder = new WiqlBuilderService();
    const queryStr = builder.buildQuery({ preset: 'overdue' });
    console.log("Generated WIQL:");
    console.log(queryStr);
}

run().catch(console.error);
