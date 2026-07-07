const fs = require('fs');
const { pipeline } = require('@xenova/transformers');
async function loadEmbedder() {
return await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
}
async function getEmbedding(embedder, text) {
const output = await embedder(text, { pooling: 'mean', normalize: true });
return Array.from(output.data);
}
async function main() {
const { chunks } = JSON.parse(fs.readFileSync('resume.json'));
const embedder = await loadEmbedder();
const vectors = [];
for (const chunk of chunks) {
const embedding = await getEmbedding(embedder, chunk);
vectors.push({ text: chunk, embedding });
}
fs.writeFileSync('embeddings.json', JSON.stringify(vectors, null, 2));
console.log(`✅ Generated embeddings for ${vectors.length} chunks`);
}
main();