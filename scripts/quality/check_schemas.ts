import { TOOLS } from '../core/tools/index';
import { validateToolSchema } from '../core/lib/schema';

let count = 0;
for (const [id, tool] of Object.entries(TOOLS)) {
  const errors = validateToolSchema(tool as unknown);
  if (errors.length > 0) {
    console.log(`Tool '${id}' failed validation:`);
    errors.forEach((err) => console.log(`  - ${err}`));
    count++;
  }
}
console.log(`Total failures: ${count}`);
if (count > 0) process.exit(1);
