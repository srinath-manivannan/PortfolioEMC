const fs = require('fs');
const { pipeline } = require('@xenova/transformers');
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
function retrieveTopChunks(questionEmbedding, storedVectors, topK = 3) {
  const scored = storedVectors.map(item => ({
    text: item.text,
    score: cosineSimilarity(questionEmbedding, item.embedding),
  }));
 
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
async function search(question) {
  const storedVectors = JSON.parse(fs.readFileSync('embeddings.json'));
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
 
  const output = await embedder(question, { pooling: 'mean', normalize: true });
  const questionEmbedding = Array.from(output.data);
 
  return retrieveTopChunks(questionEmbedding, storedVectors);
}
module.exports = { search };
// search("What are the skills?").then(results => {
//   console.log(results);
// });
