var fs = require('fs'),
    path = require('path'),
    List = require('./lib/list.js'),
    style = require('./lib/style.js'),
    Config = require('./lib/config.js'),
    parse = require('./lib/argparse.js');

var filterRegex = require('./lib/list-tasks/filter-regex.js');

function Gr() {
  this.list = new List();
  this.homePath = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
  this.config = new Config(this.homePath+'/.grconfig.json');
  this.stack = [];
}

Gr.prototype.exclude = function(arr) {
  var self = this;
  // apply filter paths
  var excludeList = arr.filter(function(item) {
    return !!item;
  }).map(function(expr) {
    expr = expr.replace('~', self.homePath);
    return new RegExp(expr);
  });

  filterRegex(this.list, excludeList);
};

Gr.prototype.parseTargets = function(argv) {
  var isTarget,
      processed = 0,
      targetPath,
      first;
  do {
    isTarget = false;
    first = argv[0].charAt(0);
    if(first == '#') {
      // #tags
      processed++;
      isTarget = true;
      argv.shift();
    } else if(first == '~' || first == '/' || first == '.') {
      // paths
      targetPath = path.resolve(argv[0], process.cwd());
      if(fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        this.list.add(targetPath);
        processed++;
        isTarget = true;
        argv.shift();
      }
    }
  } while(isTarget && argv.length > 0);

  if(processed == 0) {
    // use default setting from config
    var repos = {};
    // if the default setting is "scan", then scan
    this.list.add(this.homePath);
    // save the scanned repo list
    this.list.files.forEach(function(file) {
      repos[file.name] = {};
    });
    this.config.items.repos = repos;
    this.config.save();

  }

  // apply exclusions
  this.exclude([].concat(this.config.get('exclude'), argv['exclude']));
  delete argv['exclude'];

  // return the remaining argv
  return argv;
};

// add middleware
Gr.prototype.use = function(route, fn) {
  if (typeof route === 'function') {
    this.stack.push({ route: '', handle: route });
  } else {
    this.stack.push({ route: route, handle: fn });
  }
};

// queue and execute a set of tasks (serially)
Gr.prototype.exec = function(argv) {
  var self = this,
      tasks = [];
  this.list.files.forEach(function(file) {
   var cwd = path.dirname(file.name);
    tasks.push(function(onDone) {
      self.handle(cwd, argv, onDone);
    });
  });

  function series(task) {
    if(task) {
      task(function(result) {
        return series(tasks.shift());
      });
    }
  }
  series(tasks.shift());
};

// handle a single route resolution
Gr.prototype.handle = function(path, argv, done) {
  var stack = this.stack,
      index = 0,
      self = this;

  function next(err) {
    var layer, isMatch;
    // next callback
    layer = stack[index++];
    // all done
    if (!layer) {
      return;
    }

    isMatch = (layer.route === '');
    // skip this layer if the route doesn't match.
    if(!isMatch) {
      parts = (Array.isArray(layer.route) ? layer.route : [ layer.route ] );
      isMatch = parts.every(function(part, i) {
        return argv[i] == part;
      });
    }
    if (!isMatch) {
      return next(err);
    }

    // Call the layer handler
    // Trim off the part of the url that matches the route
    var req = {
      gr: self,
      config: self.config,
      argv: argv.slice(layer.route.length ? layer.route.length : 1 ),
      path: path,
      done: done
    };

    layer.handle(req, process.stdout, next);
  }

  next();
};

module.exports = Gr;
