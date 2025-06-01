import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import OpenAI from "openai";
import { ChromaClient } from "chromadb";
import { headersArray } from "puppeteer";

dotenv.config();

const url = "https://portfolio-sarthakbhardwaj27s-projects.vercel.app/";
const openai = new OpenAI();

const chromaClient = new ChromaClient({path: "http://localhost:8000"});
chromaClient.heartbeat()
const WEB_COLLECTION = 'WEB_SCRAPED_DATA_COLLECTION_1';

async function insertIntoDB({ embedding, url , body='', head}){
    // const collection = await chromaClient.createCollection({
    //     name: WEB_COLLECTION,
    // });
    const collection = await chromaClient.getOrCreateCollection({ name: WEB_COLLECTION });

    await collection.add({
        ids: [url],
        embeddings: [embedding],
        metadatas: [{url,body,head}]
    })
}


async function scrapeWebsite(url = "") {
  //using puppeteer to scrapte instead to cherio bcoz cherio only works for static html website but my portfolio is via reactjs

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  const content = await page.content(); // full rendered HTML

  const $ = cheerio.load(content);

  const pageHead = $("head").html();
  const pageBody = $("body").html();

  const internalLinks = new Set();
  const externalLinks = new Set();

  //get links
  $("a").each((_, el) => {
    const link = $(el).attr("href");
    if (link.startsWith("https")) {
      externalLinks.add(link);
    } else {
      internalLinks.add(link);
    }
  });
  //console.log(pageBody)
  // console.log(internalLinks)

  await browser.close();
  return { head: pageHead, body: pageBody, internalLinks, externalLinks };
}

async function generateVectorEmbeddings({text }) {
  //used openai vector embeddings
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    encoding_format: "float",
  });
  return embedding.data[0].embedding;
}

//create chunks 
function chunkText(text,chunkSize){
    if(!text || chunkSize<=0)   return[];
    const words = text.split(/\s+/);
    const chunks = [];

    for(let i=0;i<words.length;i+=chunkSize){
        chunks.push(words.slice(i,i+chunkSize).join(' '));
    }
    return chunks;
}

async function ingest(url=''){
    console.log(` -> Ingesting ${url}`);
    //scrape page from above function: 
    const {head,body,internalLinks} = await scrapeWebsite(url);
    //create embeddings
    const bodyChunks = chunkText(body,2000);
    //console.log(bodyChunks)
    const headEmbeddings = await generateVectorEmbeddings({text:head});
    //console.log(headEmbeddings)
    await insertIntoDB({embedding: headEmbeddings, url})

    for(const chunk in bodyChunks){
        const bodyEmbeddings = await generateVectorEmbeddings({text:chunk});//cant pass whole body as parameters because it is too large for open ai to create embeddings so we have to create chunk
        await insertIntoDB({embedding: headEmbeddings, url, head, body:chunk});
        //console.log(bodyEmbeddings)
    }

    //console.log(internalLinks)
    // for(const link in internalLinks){
    //     const _url = `${url}${link}`;
    //     await ingest(_url);
    // }

    console.log(` -> Ingested Success ${url}`);

}

async function chat(question = ''){
    //time stamp 34:51
    const questionEmbeddings = await generateVectorEmbeddings({text: question});
    const collection = await chromaClient.getOrCreateCollection({ name: WEB_COLLECTION });
    const collectionResult = await collection.query({
      nResults:3,
      queryEmbeddings:questionEmbeddings,
    });

    const body = collectionResult.metadatas.map(e=>console.log(e))
    console.log(`Body is: ${body}`)
}

chat('Who is Sarthak?');

// ingest(url);
// ingest('https://portfolio-sarthakbhardwaj27s-projects.vercel.app/#about')
// ingest('https://portfolio-sarthakbhardwaj27s-projects.vercel.app/#projects')
// ingest('https://portfolio-sarthakbhardwaj27s-projects.vercel.app/#contact')
