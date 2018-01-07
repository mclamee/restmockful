const sys = {
	name: "restmockful", 
	author: "mclamee", 
	port: 80,
	encoding: "utf8",
	webapps: "apps",
	apps: {
		names: [],
		rules: {}
	},
	assets: {
		home: "static",
		rules: {}
	}
}

var http = require('http');
var fs = require('fs');
var url = require('url');
var path = require('path');
var mime = require('mime');

function init(){
	
	// rules
	function extractRules(rules, appName){
		
		const appHome = sys.webapps + appName;
		const configPath = appHome + "/index.json"
		
		fs.readFile(configPath, sys.encoding, (err, jsonStr) => {
			if(err || !jsonStr){
				console.error("Error Loading Config File: " + configPath);
				if(err)
					console.error(err);
				return;
			}
			
			function validateJson(jsonStr){
				var configs;
				try{
					configs = JSON.parse(jsonStr);
				}catch(e){
					console.error("Invalid JSON Format: " + configPath)
					return false;
				}
				if(!(configs.version && configs.rules && configs.rules.length > 0)){
					console.error("Invalid Configuration Format: " + configPath)
					return false;
				}
				return configs;
			}
			
			var configs = validateJson(jsonStr);
			
			if(configs)
				configs.rules.forEach(c => {
					var rule = {};
					
					const cUrl = c.url || "/";
					const cName = c.name || "";
					const cParams = c.params || [];
					const cMethod = c.method || "get";
					const cCode = c.resp.header.code || 200;
					const cType = c.resp.header.type || "";
					const cDataFile = c.resp.dataFile || "";
					const cSamples = c.samples || [];
					
					const regexUrlParam = /{([\w\d\s_-]*)}/g
					const cUrlParams = findGroups(regexUrlParam, cUrl, 1);
					
					const cUrlPattern = "^" + cUrlParams.reduce((a, u) => {
						var item = "{"+u+"}"
						a = a.replace(item, "([\\w\\d\\s_-]+)")
						return a;
					}, appName + cUrl) + "$";
					
					console.log("Rule URL Pattern: " + cUrlPattern)
					
					// add values
					rule.appName = appName;
					rule.appHome = appHome;
					rule.configPath = configPath;
					rule.config = c;
					
					rule.cName = cName;
					rule.cUrl = cUrl;
					rule.cParams = cParams;
					rule.cMethod = cMethod;
					rule.cCode = cCode;
					rule.cType = cType;
					rule.cDataFile = cDataFile;
					rule.cSamples = cSamples;
					
					rule.cUrlParams = cUrlParams;
					rule.cUrlPattern = cUrlPattern;
					
					rules.push(rule);
				});
			
			console.log(prettyJSON(rules))
			
			if(rules && rules.length > 0){
				sys.apps.names.push(appName);
			}
			
		});
	}
	
	// resMap
	function extractStaticAssets(rules, appName){
		const appHome = sys.webapps + appName;
		const assetsHome = appHome + "/" + sys.assets.home;
		
		walk(assetsHome, function(err, results) {
			if (err) {
				console.error("Load Resources Failed:", err)
				return;
			}
			//console.log(results);
			
			var resMap = results.reduce((a, file) => {
				var relative = "/" + path.relative(assetsHome, file).replace(/\\+/g, "/");
				var valObj = {app: appName, home: assetsHome, path: file, url: relative, type: mime.getExtension(mime.getType(file))};
				a[relative] = valObj;
				return a;
			}, {})
			
			console.log(prettyJSON(resMap));
			
			rules.merge(resMap);
			
			//console.log(prettyJSON(rules));
		});
	}
	
	sys.apps.names = [];
	sys.apps.rules = {};
	sys.assets.rules = {};
	
	fs.readdirSync(sys.webapps).forEach(fileName => {
		const appName = "/"+fileName;
		sys.apps.rules[appName] = [];
		extractRules(sys.apps.rules[appName], appName);
		extractStaticAssets(sys.assets.rules, appName);
	});
	
}

init();

http.createServer(function (req, res) {
	console.log("-----------------------------------------------------------\nRequest URL: " + req.url + "\n-----------------------------------------------------------")
	//console.log(sys.assets.rules)
	
	const reqUrl = url.parse(req.url, true);
	console.log("Request URL: " + prettyJSON(reqUrl))
	
	var query = reqUrl.query;
	console.log("> Query Params: " + prettyJSON(query))
	
	switch (reqUrl.pathname){
		case "/favicon.ico":

			respFile(res, "favicon.ico", "ico")
			
			break;
		
		case validAssetPath(reqUrl.pathname):
			var assetRule = sys.assets.rules[reqUrl.pathname];
			console.log("Getting Static Asset: " + assetRule.path)
			
			respFile(res, assetRule.path, assetRule.type)
			
			break;
			
		case "/" + sys.webapps:
			var appsListStr = sys.apps.names.map(name => {
				return `<li><a href="${name}">${name}</a></li>`
			}).reduce((s, i) => s + i);
			
			var content = "<html><body><h4>Mock Services: </h4><p><ul>"+appsListStr+"</ul></p></body></html>";
			
			resp200(res, content);
			
			break;
			
		case "":
		case "/":
		case "/index":
		case "/index.html":
			
			resp301(res, "/" + sys.webapps)
			
			break;
		case validServicePath(reqUrl.pathname):
			const servicePath = reqUrl.pathname;
			console.log("INSIDE: " + servicePath + "!");
			
			const appName = extractAppName(servicePath);
			
			if(servicePath == appName || servicePath == appName + "/"){
				console.log("AT ROOT!");
				// render the samples
				var uls = sys.apps.rules[appName].reduce((ul, rule) => {
					
					var lis = rule.cSamples.reduce((li, sample) => {
						var url = appName + sample
						return li + `<li><a href="${url}">${sample}</a></li>`
					}, "");
					
					return ul + (lis?`<p>${rule.cName}</p><ul>${lis}</ul>`:"")
					
				}, "");
				
				var content = "\
				<html>\
					<body>\
						<h3>Sample Requests for "+appName+"</h3>\
						"+uls+"\
					</body>\
				</html>\
				";
				
				resp200(res, content);
				
			} else {
				console.log("AT SUB!");
				// send response by rules
				var hasResponse = sys.apps.rules[appName].reduce((hasResponse, rule) => {
					
					return hasResponse || genResponse(rule, servicePath, query);
						
					function genResponse(rule, servicePath, query){
						let [cUrlPattern, cUrlParams, cDataFile, cCode, cType, appHome] 
							= [rule.cUrlPattern, rule.cUrlParams, rule.cDataFile, rule.cCode, rule.cType, rule.appHome]
						
						var urlPassed = new RegExp(cUrlPattern).exec(servicePath);
						
						if(urlPassed){
							console.log("URL PATTERN FOUND for RULE "+appName+": " + urlPassed[0])
							
							// extract URL params
							var parsedParamsMap = cUrlParams.reduce((a, u, i) => {
								a[u] = urlPassed[i + 1];
								return a;
							}, {});
							
							// add query params to the map
							parsedParamsMap = Object.assign(query, parsedParamsMap)
							
							// add default values to the params
							var ruleParams = [].concat(rule.cParams).concat(rule.cUrlParams)
							var valueKeys = Object.keys(parsedParamsMap);
							ruleParams.filter(k => !valueKeys.includes(k)).forEach(k => parsedParamsMap[k] = "");

							console.log("All Params Map: " + prettyJSON(parsedParamsMap));
							
							var dataFile = findDataFile(appHome, cDataFile, parsedParamsMap);
							console.log("dataFile: " + dataFile)
							
							const errFileInvalid = "500 Target File Invalid Or Non-exists: ";
							if(!dataFile){
								resp500(res, errFileInvalid + cDataFile)
								
							} else {
								fs.readFile(dataFile, sys.encoding, function(err, fileContent) {
									if (err) {
										if (err.code === 'ENOENT') {
											resp500(res, errFileInvalid + dataFile)
										} else {
											resp404(res);
										}
										return;
									}
									fileContent = replaceContent(fileContent, parsedParamsMap)
									//console.log("fileContent: " + fileContent)
									var fileType = cType?determineContentType(cType):determineContentType(dataFile);
									// customized response
									res.writeHead(cCode, {'Content-Type': fileType});
									res.write(fileContent);
									res.end();
								})
							}
							return true;
						}
						return false;
					}
				}, false);
				
				if(!hasResponse){
					resp404(res)
				}
			}
			
			break;
		default:
			resp404(res);
	}
	
	function validAssetPath(pathName){
		return sys.assets.rules[pathName]?pathName:"{INVALID_RESOURCE_PATH}";
	}
		
	function validServicePath(urlPathName){
		var test = sys.apps.names.filter(t => urlPathName.indexOf(t) == 0).length > 0;
		return test?urlPathName:"{INVALID_SERVICE_PATH}";
	}
	
	function extractAppName(pathname){
		return sys.apps.names.find(t => pathname.indexOf(t) == 0);
	}
	
	function findDataFile(appHome, pathStr, params){
		console.log("pathStr: " + pathStr);
		return appHome + "/" + replaceContent(pathStr, params);
	}
	
	function resp404(res, errMsg = "404 Not Found!"){
		console.error(errMsg);
		res.writeHead(404, {'Content-Type': 'text/html'});
		res.write(errMsg);
		res.end();
	}

	function resp500(res, errMsg = "500 Server Error"){
		console.error(errMsg);
		res.writeHead(500, {'Content-Type': 'text/html'});
		res.write(errMsg);
		res.end();
	}
	
	function resp200(res, content, type = 'html'){
		res.writeHead(200, {'Content-Type': determineContentType(type)});
		res.write(content);
		res.end();
	}
	
	function resp301(res, url){
		res.writeHead(301, {
			Location: url
		});
		res.end();
	}
	
	function respFile(response, filePath, fileType = null){
		var st = fs.statSync(filePath);
		var type = fileType? determineContentType(fileType): determineContentType(filePath)
		
		response.writeHead(200, {
			'Content-Type': type,
			'Content-Length': st.size
		});

		var readStream = fs.createReadStream(filePath);
		// piped solution
		readStream.pipe(response);
	}

}).listen(sys.port);

// -- tools
function replaceContent(content, params){
	return Object.keys(params)
		.reduce((a, k) => a.replace(new RegExp("{{"+k+"}}", "g"), params[k]), ""+content)
}

function findGroups(reg, str, groupIndex, debug = false){
	var m;
	var matches = [];
	while((m = reg.exec(str)) != null){
		if (m.index === reg.lastIndex) {
			reg.lastIndex++;
		}
		matches.push(m[groupIndex]);
	}
	if(debug)
		console.log("findGroups matches: " + matches)
	return matches;
}

function extractGroups(regex, str, fnExtract, debug = false){
	var list = [];
	var m;
	while ((m = regex.exec(str)) !== null) {
		// This is necessary to avoid infinite loops with zero-width matches
		if (m.index === regex.lastIndex) {
			regex.lastIndex++;
		}
		if(debug)
		// The result can be accessed through the `m`-variable.
		m.forEach((match, groupIndex) => {
			console.log(`Found match, group ${groupIndex}: ${match}`);
		});
		
		function wrap(fn, x){
			return fn(x);
		}
		var resp = wrap(fnExtract, m);
		if(resp != undefined)
			list.push(resp);
	}
	return list;
}

function determineContentType(typeOrFile){
	return mime.getType(typeOrFile);
}

function prettyJSON(obj){
	return JSON.stringify(obj, null, 2);
}

function walk(dir, done) {
  var results = [];
  fs.readdir(dir, function(err, list) {
    if (err) return done(err);
    var pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function(file) {
      file = path.resolve(dir, file);
      fs.stat(file, function(err, stat) {
        if (stat && stat.isDirectory()) {
          walk(file, function(err, res) {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
};

String.prototype.contains = function(x){return this.indexOf(x) != -1}
Object.prototype.merge = function(obj){return Object.assign(this, obj)}