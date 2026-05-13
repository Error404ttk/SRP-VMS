import fs from 'fs';
import path from 'path';

const viewsDir = path.join(process.cwd(), 'views');
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.ejs'));

for (const file of files) {
  const filePath = path.join(viewsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace Apps Script closing tags
  content = content.replace(/\?>/g, '%>');
  
  // Fix includes
  content = content.replace(/<%- include\('Style'\);? %>/g, '<%- include(\'style\') %>');
  content = content.replace(/<%- include\('Script'\);? %>/g, '<%- include(\'script\') %>');
  content = content.replace(/<%- include\('ReleaseNotes'\);? %>/g, '<%- include(\'release-notes\') %>');
  content = content.replace(/<%- include\(contentPage\);? %>/g, '<%- include(contentPage) %>');
  
  fs.writeFileSync(filePath, content);
}
console.log('Fixed closing tags in all EJS files');
