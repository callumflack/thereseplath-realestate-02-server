const fs = require('fs');
const config = require('./config/config');
const path = require('path');
const parseString = require('xml2js').parseString;
const simpleGit = require('simple-git')(config.jsonPath);
const https = require('https');

const low = require('lowdb');
const currentDB = low('db/current.json');
const soldDB = low('db/sold.json');

currentDB.defaults({
	propertyList: [],
})
.value();

soldDB.defaults({
	propertyList: [],
})
.value();


/**
 * Log time stamped text to stdout
 *
 * @param {String|Error} text
 */

function logByDate(text) {
	console.log(new Date().toUTCString() + '\n' + text + '\n');
}

/**
 * General use error handler
 *
 * @param {Error} err
 */

function errorHandler(err) {
	logByDate(err);
	throw err;
}

/**
 * Strip surrounding array from the value of uniqueID on each property,
 * then lowercase the string, so we can use uniqueID in Jekyll config.
 *
 * @param {Array} properties
 * @return {Array}
 */

function stripArrayFromUniqueID(properties) {
	return properties.map((property) => {
		property.uniqueID = property.uniqueID[0].toLowerCase();
		return property;
	});
}

/**
 * Publish new version of site leaf website
 */

function siteLeafPublish() {
	return new Promise((resolve, reject) => {
		let request_options = {
			host: 'api.siteleaf.com',
			path: `/v2/sites/${config.siteLeaf.siteId}/publish`,
			method: 'POST',
			auth: `${config.siteLeaf.apiKey}:${config.siteLeaf.apiSecret}`,
		};

		let request = https.request(request_options, (res) => {
			res.setEncoding('utf-8');
			res.on('data', (chunk) => {
				resolve();
			});
		});

		request.on('error', errorHandler);

		request.write(JSON.stringify({}));
		request.end();
	});
}

/**
 * Commit & push JSON to github jekyll repo
 */

function pushToGit() {
	return new Promise((resolve, reject) => {
		simpleGit
		.pull()
		.then((values) => {
			let current = currentDB.get('propertyList').value();
			let sold = soldDB.get('propertyList').value();

			current = stripArrayFromUniqueID(current);
			sold = stripArrayFromUniqueID(sold);

			currentStringified = JSON.stringify(current, null, 2);
			soldStringified = JSON.stringify(sold, null, 2);

			fs.writeFile(path.join(config.jsonPath, 'current.json'), currentStringified, (err) => {
				if (err) return reject(err);

				fs.writeFile(path.join(config.jsonPath, 'sold.json'), soldStringified, (err) => {
					if (err) return reject(err);

					simpleGit
					.add('*')
					.commit('JSON data - ' + new Date().toUTCString())
					.push()
					.then((err, update) => {
						if (err) {
							return reject(err);
						}

						resolve();
					}, errorHandler);
				});
			});
		}, errorHandler);
	});
}

/**
 * Move file from XML folder to history folder
 *
 * @param {String} file
 */

async function moveToHistory(file) {
	fs.rename(path.join(config.xmlPath, file), path.join(config.historyPath, file), (err) => {
		if (err) throw err;

		return;
	});
}

/**
 * Update 'current' & 'sold' JSON databases with provided data
 *
 * @param {Object} jsonData
 */

async function updateDB(jsonData) {
	let properties = jsonData.propertyList.residential || [];

	properties = properties.filter((property) => {
		return property.listingAgent[0].name[0] === 'Therese Plath';
	});

	if (!properties) {
		return;
	}

	properties.forEach((property) => {
		let propertySold = property.$.status === 'sold';
		let propertyRemoved = !propertySold && property.$.status !== 'current';
		let inCurrentDB = currentDB.get('propertyList')
		.find({ uniqueID: property.uniqueID })
		.value();

		// All properties already in the 'current' db will either be updated with
		// new data, moved to 'sold' db or removed entirely
		if (inCurrentDB) {
			currentDB.get('propertyList')
			.remove({ uniqueID: property.uniqueID })
			.value();
		}

		if (propertyRemoved) {
			return;
		}

		if (propertySold) {
			soldDB.get('propertyList')
			.push(property)
			.value();

			return;
		}

		currentDB.get('propertyList')
		.push(property)
		.value();
	});

	return;
}

/**
 * Convert content of XML file to JSON
 *
 * @param {String} file
 * @return {Object}
 */

async function xmlFileToJson(file) {
	return await new Promise((resolve, reject) => {
		fs.readFile(path.join(config.xmlPath, file), 'utf-8', (err, xmlData) => {
			if (err) return reject(err);

			parseString(xmlData, (err, jsonData) => {
				if (err) return reject(err);

				resolve(jsonData);
			});
		});
	});
}

/**
 * Populate JSON databases with data from listed XML files
 * One by one convert data of listed XML files to JSON and store in JSON database
 *
 * @param {Array[String]} files
 */

async function processFiles(files) {
	for (const file of files) {
		const json = await xmlFileToJson(file);
		await updateDB(json);
		await moveToHistory(file);
	}
}

function main() {
	fs.readdir(config.xmlPath, (err, files) => {
		if (err) {
			errorHandler(err);
		}

		if (!files.length) {
			logByDate('No files to be processed');
			return;
		}

		files = files.sort();

		processFiles(files)
		.then(pushToGit)
		.then(siteLeafPublish)
		.then(() => {
			logByDate('Updates successully pushed.');
		}, errorHandler);
	});
}

main();
