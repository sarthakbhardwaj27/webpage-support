import axios from "axios";
import * as Cheerio from "cheerio";
import OpenAI from "openai";
import dotenv from "dotenv";
import { ChromaClient } from "chromadb";

dotenv.config();

const openai = new OpenAI();

const chromaClient = new ChromaClient({ path: "http://localhost:8000" });
const WEB_COLLECTION = "WEB_SCRAPED_DATA_COLLECTION_1";
chromaClient.heartbeat();

async function insertIntoDB({ embedding, url, body = "", head }) {
  const collection = await chromaClient.getOrCreateCollection({
    name: WEB_COLLECTION,
  });

  await collection.add({
    ids: [url],
    embeddings: embedding,
    metadatas: [{ url, body, head }],
  });
}

async function scrapeWebpage(url = "") {
  const { data } = await axios.get(url);
  const $ = Cheerio.load(data);

  const pageHead = $("head").html();
  const pageBody = $("body").html();

  const internalLinks = new Set();
  const externalLinks = new Set();

  $("a").each((_, el) => {
    const link = $(el).attr("href");
    console.log(link)
    if (link === "/") return;
    try{
        if(link.includes("hevo")){
            console.log(link)
            internalLinks.add(link);
        }
    }catch(err){
        console.log(`Ignoring ${link} due to error ${err}`)
        return;
    }
    // if (link.includes("hevodata")) {
    //   internalLinks.add(link);
    // } else {
    //   externalLinks.add(link);
    // }
  });
  //console.log(internalLinks)
  return {
    head: pageHead,
    body: pageBody,
    internalLinks: Array.from(internalLinks),
    externalLinks: Array.from(externalLinks),
  };
}

async function generateVectorEmbeddings({ text }) {
  if (!text || text.trim() === "") {
    throw new Error("Text for embedding generation is empty or undefined");
  }
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    encoding_format: "float",
  });
  return embedding.data[0].embedding;
}

//create chunks
function chunkText(text, chunkSize) {
  if (!text || chunkSize <= 0) return [];
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}
const visitedUrls = new Set();

async function ingest(url = "") {
  console.log(`-> Ingesting ${url}`);
  const { head, body, internalLinks } = await scrapeWebpage(url);

  // const headEmbeddings = await generateVectorEmbeddings(head);
  // await insertIntoDB({embeddings: headEmbeddings, url, body, head});

  const bodyChunks = chunkText(body, 1000);
  for (const chunk of bodyChunks) {
    //console.log(chunk + '##############');
    const bodyEmbeddings = await generateVectorEmbeddings({ text: chunk });
    // console.log(bodyEmbeddings)
    await insertIntoDB({ embedding: bodyEmbeddings, url, body: chunk, head });
  }

  for (const link of internalLinks) {
    try {
      const _url = new URL(link, url).href; // Safely resolve relative paths
      if (visitedUrls.has(_url)) {
        return;
      } else if (!visitedUrls.has(_url)) {
        console.log(_url);
        visitedUrls.add(_url);
        await ingest(_url);
      }
    } catch (err) {
      console.warn(`Invalid link skipped: ${link}`);
    }
  }
  console.log(`-> Ingested ${url}`);
}

async function chat(question = "") {
  const questionEmbedding = await generateVectorEmbeddings({ text: question });
  const collection = await chromaClient.getOrCreateCollection({
    name: WEB_COLLECTION,
  });

  const collectionResult = await collection.query({
    nResults: 3,
    queryEmbeddings: questionEmbedding,
  });

  const body = collectionResult.metadatas[0].map((e) => e.body);
  const url = collectionResult.metadatas[0].map((e) => e.url);
  //console.log(body)

  //chatgpt response
  const reponse = await openai.chat.completions.create({
    model: "chatgpt-4o-latest",
    messages: [
      {
        role: "system",
        content:
          "You are an AI support agent, expert in providing support to users on behalf of a webpage. Given the context about page content, reply the user accordingly",
      },
      {
        role: 'user',
        content: `
        Query: ${question}\n\n
        URLs: ${url.join(', ')}
        Retrieved context: ${body.join(', ')}
        `,
      }
    ],
  });
  console.log(`Bot replied: ${reponse.choices[0].message.content}`);
}

chat("What is Hevo? Does it support Redshift as a source?");


//ingest('https://docs.hevodata.com/')

