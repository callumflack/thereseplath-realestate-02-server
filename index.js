const fs = require('fs');
const config = require('./config/config');
const path = require('path');
const parseString = require('xml2js').parseString;
const simpleGit = require('simple-git')(config.gitPath);

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
 * Commit & push JSON to github jekyll repo
 */

function pushToGit() {
	return new Promise((resolve, reject) => {
		const current = currentDB.get('propertyList').value();
		const sold = soldDB.get('propertyList').value();
		currentStringified = JSON.stringify(current);
		soldStringified = JSON.stringify(sold);

		fs.writeFile(path.join(config.gitPath, 'current'), currentStringified, (err) => {
			if (err) return reject(err);

			fs.writeFile(path.join(config.gitPath, 'sold'), soldStringified, (err) => {
				if (err) return reject(err);

				simpleGit
				.pull()
				.add('*')
				.commit('JSON data - ' + new Date().toUTCString())
				.push()
				.then((err, update) => {
					if (err) {
						return reject(err);
					}

					resolve();
				});
			});
		});
	});
}

/**
 * Move file from XML folder to history folder
 *
 * @param {String} file
 */

function moveToHistory(file) {
	return new Promise((resolve, reject) => {
		fs.rename(path.join(config.xmlPath, file), path.join(config.historyPath, file), (err) => {
			if (err) return reject(err);

			resolve();
		});
	});
}

/**
 * Update 'current' & 'sold' JSON databases with provided data
 *
 * @param {Object} jsonData
 */

function updateDB(jsonData) {
	return new Promise((resolve, reject) => {
		let properties = jsonData.propertyList.residential || [];

		properties = properties.filter((property) => {
			return property.listingAgent[0].name[0] === 'Therese Plath';
		});

		if (!properties) {
			return resolve();
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

				const soldListingsLimit = 3;
				let soldDBListingCount = soldDB.get('propertyList')
				.value().length;

				if (soldDBListingCount > soldListingsLimit) {
					let oldestSoldListing = soldDB.get('propertyList')
					.sortBy('$.modTime')
					.take(1)
					.value()[0];

					soldDB.get('propertyList')
					.remove({ uniqueID: oldestSoldListing.uniqueID })
					.value();
				}

				return;
			}

			currentDB.get('propertyList')
			.push(property)
			.value();
		});

		resolve();
	});
}

/**
 * Convert contentx of XML file to JSON
 *
 * @param {String} file
 * @return {Promise[Object]}
 */

function xmlFileToJson(file) {
	return new Promise((resolve, reject) => {
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

function processFiles(files) {
	return new Promise((resolve, reject) => {
		let file = files.shift();

		xmlFileToJson(file)
		.then(updateDB)
		.then((value) => {
			moveToHistory(file)
			.then(() => {
				if (files.length) {
					processFiles(files).then(resolve);
				} else {
					resolve();
				}
			});
		});
	});
}

function main() {
	fs.readdir(config.xmlPath, (err, files) => {
		if (!files.length) {
			return;
		}

		files = files.sort();

		processFiles(files)
		.then((value) => {
			pushToGit();
		});
	});
}

main();