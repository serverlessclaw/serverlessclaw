const fs = require('fs');

let content = fs.readFileSync('core/lib/mcp/tool-mapper.test.ts', 'utf8');

// For test 1: path
content = content.replace(
  /await tools\[0\]\.execute\(\{ path: '\/etc\/passwd' \}\);\s*expect\(checkFileSecurity\)\.toHaveBeenCalledWith\(\s*'\/etc\/passwd',\s*undefined,\s*'MCP operation \(read_file\)'\s*\);/g,
  `await tools[0].execute({ path: '/etc/passwd' });\n      expect(checkFileSecurity).toHaveBeenCalledWith(\n        '/etc/passwd',\n        undefined,\n        'MCP operation (read_file) [arg: path]'\n      );`
);

// For test 2: path_to_file
content = content.replace(
  /await tools\[0\]\.execute\(\{ path_to_file: '\/some\/file\.txt' \}\);\s*expect\(checkFileSecurity\)\.toHaveBeenCalledWith\(\s*'\/some\/file\.txt',\s*undefined,\s*'MCP operation \(read_file\)'\s*\);/g,
  `await tools[0].execute({ path_to_file: '/some/file.txt' });\n      expect(checkFileSecurity).toHaveBeenCalledWith(\n        '/some/file.txt',\n        undefined,\n        'MCP operation (read_file) [arg: path_to_file]'\n      );`
);

// For test 3: file_path
content = content.replace(
  /await tools\[0\]\.execute\(\{ file_path: '\/some\/file\.txt' \}\);\s*expect\(checkFileSecurity\)\.toHaveBeenCalledWith\(\s*'\/some\/file\.txt',\s*undefined,\s*'MCP operation \(read_file\)'\s*\);/g,
  `await tools[0].execute({ file_path: '/some/file.txt' });\n      expect(checkFileSecurity).toHaveBeenCalledWith(\n        '/some/file.txt',\n        undefined,\n        'MCP operation (read_file) [arg: file_path]'\n      );`
);

fs.writeFileSync('core/lib/mcp/tool-mapper.test.ts', content);
