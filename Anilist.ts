// Imports

import axios, { AxiosError, AxiosResponse } from "axios";
import fs from "fs";

import { isObject, objHasProp } from ".";

// Types

interface MediaListCollection {
	lists: {
		name: string;
		status: string;
		entries: {
			progress: number;
			media: {
				id: number;
			}
		}[]
	}[]
}


// Validation Functions

function isAxiosError (x: unknown): x is AxiosError {
	return (
		isObject(x) &&
		// objHasProp(x, `isAxiosError`) && typeof x.isAxiosError === `boolean` && x.isAxiosError
		objHasProp(x, `name`) && typeof x.name === `string` && x.name === `AxiosError`
	);
}

// Functions

function sleep (ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// Class

export default class Anilist {
	userName: string;
	debug: boolean;

	LAST_CALL: number;
	TIME_BUFFER: number;
	
	constructor (userName: string, debug = false) {
		this.userName = userName;
		this.debug = debug;

		this.LAST_CALL = Date.now();
		this.TIME_BUFFER = 1e3;
	}

	debugLog (...args: any[]) {
		if (!this.debug) return;
		console.log(`(D)`, ...args);
	}

	async checkTimeBuffer () {
		const now = Date.now();
		const timeSince = now - this.LAST_CALL;
		if (timeSince >= this.TIME_BUFFER) return;

		const timeDif = this.TIME_BUFFER - timeSince;
		this.debugLog(`Waiting for ${timeDif}ms`);
		await sleep(timeDif);
		return;
	}

	async gql (query: string, variables?: Record<string, any>): Promise<AxiosResponse<any, any>> {
		if (!variables) variables = {};

		await this.checkTimeBuffer();

		try {
			this.LAST_CALL = Date.now();
			const response = await axios({
				url: `https://graphql.anilist.co`,
				method: `POST`,
				data: { query, variables, },
			});

			return response;
		} catch (error) {
			if ( isAxiosError(error) ) {
				const status = error.response?.status;

				if (status === 429) {
					

					const headers = error.response?.headers;
					if ( isObject(headers) && objHasProp(headers, `retry-after`) && typeof headers["retry-after"] === `string` ) {
						const seconds = Number.parseInt(headers["retry-after"]);
						this.debugLog(`Too many requests, waiting for ${seconds} seconds.`);
						await sleep(seconds * 1e3);
					} else {
						this.debugLog(`Got "Too Many Requests", Trying again.`);
					}
					
					return await this.gql(query, variables);
				}
				else if (status)throw new Error(`(X) Axios Error: ${status}`);
				else throw new Error(`(X) Axios Error: Unknown`);
			}

			fs.writeFileSync(`anilistUnknownError.json`, JSON.stringify(error, undefined, 2));
			throw new Error(`(X) Unknown error.`);
		}
	}

	async getUserManga () {
		interface ApiResponse {
			data: {
				MediaListCollection: MediaListCollection;
			};
		}

		await this.checkTimeBuffer();

		const response = await this.gql(
			`query ($userName: String) {
				MediaListCollection (userName: $userName, type: MANGA, status: CURRENT) {
					lists {
						name, status

						entries {
							progress
							media { id }
						}
					}
				}
			}`,
			{ userName: this.userName, }
		);

		const data = response.data as ApiResponse;
		return data.data.MediaListCollection;
	}
}
