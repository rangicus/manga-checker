// Imports

import axios from "axios";
import { load as cheerioLoad } from "cheerio";
import fs from "fs";
import moment from "moment";

import Anilist from "./Anilist";

// Types

type MangaProvider = `viz` | `mangadex`;

interface ConfigData {
	anilistUsername: string;
	manga: Manga[];
}

interface Manga {
	name: string;
	anilistId: number;

	siteId: string;
	provider: MangaProvider;
}

interface Result {
	manga: Manga;

	chapter: number;
	url: string;

	release: Date;
	releaseRelative: string;
}

interface MangaDexSeriesResponse {
	result: `ok`;
	response: `collection`;
	data: {
		id: string;
		type: string;
		attributes: {
			volume: string;
			chapter: string;
			title: string;
			translatedLanguage: string;
			externalUrl: null;
			publishAt: string;
			readableAt: string;
			createdAt: string;
			updatedAt: string;
			pages: number;
			version: number;
		}
		relationships: {
			id: string;
			type: string;
		}[]
	}[]
}

// Validation Functions

export function isObject (x: unknown): x is object {
	return (
		typeof x === `object` && x !== null
	)
}

export function objHasProp<X extends {}, Y extends PropertyKey> (obj: X, prop: Y): obj is X & Record<Y, unknown> {
	return obj.hasOwnProperty(prop);
}

function isMangaProvider (x: unknown): x is MangaProvider {
	return (
		typeof x === `string` &&
		(
			x === `viz` ||
			x === `mangadex`
		)
	);
}

function isManga (x: unknown): x is Manga {
	return (
		typeof x === `object` &&
		x !== null &&
		objHasProp(x, `name`) && typeof x.name === `string` &&
		objHasProp(x, `anilistId`) && typeof x.anilistId === `number` &&
		objHasProp(x, `siteId`) && typeof x.siteId === `string` &&
		objHasProp(x, `provider`) && isMangaProvider(x.provider)
	)
}

function isConfigData (x: unknown): x is ConfigData {
	if (!(
		typeof x === `object` && x !== null &&
		objHasProp(x, `anilistUsername`) && typeof x.anilistUsername === `string` &&
		objHasProp(x, `manga`) && Array.isArray(x.manga)
	)) return false;

	for (let i = 0; i < x.manga.length; i ++) {
		const m = x.manga[i];
		if(!( isManga(m) )) return false;
	}
	
	return true;
}

// Functions

async function scrapeViz (manga: Manga): Promise<Result> {
	try {
		const { data } = await axios.get(`https://www.viz.com/shonenjump/chapters/` + manga.siteId);
		const $ = cheerioLoad(data);

		const eChapters = $(`a[id^=ch]`);
		if (eChapters.length === 0) throw new Error(`Couldn't find chapters.`);
		
		// Parsing
		const eChapter = eChapters[0];

		const releaseString = $(eChapter).find(`div:first-child td`).text();
		const release = new Date(releaseString);

		const chapterString = $(eChapter).find(`.ch-num-list-spacing > div`).text();
		const chapter = Number.parseInt(chapterString.replace(/\D/g, ``));

		const urlString = $(eChapter).attr(`href`);
		if (!urlString) throw new Error(`Couldn't get chapter link.`);

		return {
			manga, chapter, release,
			url: `https://www.viz.com` + urlString,
			releaseRelative: moment(release).fromNow(),
		};
	} catch (error) {
		console.error(error);
		throw error;
	}
}

async function scrapeMangadex (manga: Manga): Promise<Result> {
	const params = new URLSearchParams({
		limit: "10",
		"translatedLanguage[]": "en",
		"order[chapter]": "desc",
	});

	const res = await axios.get(`https://api.mangadex.org/manga/${manga.siteId}/feed?${params.toString()}`);
	const dres = res.data as MangaDexSeriesResponse;

	const chapters = dres.data;
	if (chapters.length === 0) throw new Error(`Couldn't find chapters.`);

	const target = chapters[0];
	const release = new Date( target.attributes.readableAt );

	return {
		manga, release,
		chapter: Number.parseInt( target.attributes.chapter ),
		releaseRelative: moment(release).fromNow(),
		url: `https://mangadex.org/chapter/${ target.id }`,
	};
}

async function scrapeManga (manga: Manga): Promise<Result> {
	if (manga.provider === `viz`) return await scrapeViz(manga);
	else if (manga.provider === `mangadex`) return await scrapeMangadex(manga);
	else throw new Error(`Unknown provider.`);
}

function getConfig (): ConfigData {
	const raw = fs.readFileSync(`config.json`).toString();
	const config = JSON.parse(raw);
	if ( isConfigData(config) ) return config;
	else throw new Error(`Invalid Config data.`);
}

// Globals

const ani = new Anilist(`rangicus`, true);

// Main

async function main () {
	// const targets = getTargets();
	const config = getConfig();
	config.manga.sort((a, b) => a.name.localeCompare(b.name));

	// Get results.
	const results: Result[] = [];
	for (let i = 0; i < config.manga.length; i ++) {
		const target = config.manga[i];
		console.log(`Scraping`, target.name, `(${i + 1} / ${config.manga.length})`, `...`);
		
		const result = await scrapeManga(target);
		results.push(result);
	}

	// Get anilist data.
	const completedResults: Result[] = [];
	const behindResults: Result[] = [];
	
	console.log(`Getting Anilist data...`);
	const mediaListCollection = await ani.getUserManga();
	for (const list of mediaListCollection.lists) {
		for (const media of list.entries) {
			const id = media.media.id;
			const result = results.find((x) => x.manga.anilistId === id);
			if (result) {
				if (media.progress >= result.chapter) completedResults.push(result);
				else behindResults.push(result);
			}
		}
	}

	// Display Results
	console.log(`- - -`);
	
	completedResults.sort((a, b) => a.manga.name.localeCompare(b.manga.name));
	console.log(`Caught up (${completedResults.length}):`, completedResults.map((x) => x.manga.name).join(`, `), `\n`);	

	behindResults.sort((a, b) => b.release.getTime() - a.release.getTime());
	for (const result of behindResults) {
		console.log(`${result.manga.name}: ${result.chapter} - ${result.releaseRelative} (${result.url})`);
	}
}

for (let i = 0; i < 10; i ++) console.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);

main();
