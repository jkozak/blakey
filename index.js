"use strict";

const     cp = require('child_process');
const     fs = require('fs');
const   path = require('path');
const   walk = require('walk');
const assert = require('assert');
const VError = require('verror');

function findDeploymentBase(dir) {
    const repo = path.join(dir,'repo.git');
    if (fs.existsSync(repo)) {
        assert(fs.statSync(repo).isDirectory());
        return dir;
    } else if (dir==='/')
        return null;
    else
        return findDeploymentBase(path.dirname(dir));
}

const findLinksTo = exports.findLinksTo = (dir,target)=>{
    const links = new Set();
    if (!dir.endsWith('/'))
        dir += '/';             // for path surgery below
    walk.walkSync(dir,{
        listeners: {
            names: (root,names)=>{
                names.forEach((name)=>{
                    const p = path.join(root,name);
                    if (fs.lstatSync(p).isSymbolicLink()) {
                        const q = fs.readlinkSync(p);
                        const r = path.relative(target,q);
                        if (!r.startsWith('..')) {
                            const x = p.slice(dir.length);
                            links.add(x);
                        }
                    }
                });
            }
        },
        followLinks:false
    });
    return Array.from(links).sort();
};

const isServiceRunning = exports.isServiceRunning = (service)=>{
    try {
        cp.execSync(`sudo systemctl is-active --quiet ${service}`);
        return true;
    } catch (e) {
        return false;
    }
}

const getAffectedServices = exports.getAffectedServices = (base,commit,opts)=>{
    const services = new Set();

    opts.apache2Dirs.forEach((d)=>{
        findLinksTo(d,base).forEach(()=>services.add('apache2'));
    });
    opts.systemdDirs.forEach((d)=>{
        findLinksTo(d,base).forEach((l)=>services.add(path.basename(l)));
    });
    services.forEach((s)=>{
        if (!opts.isServiceRunning(s))
            services.delete(s);
    });
    return Array.from(services).sort();
};

const initVersionWorkDir = exports.initVersionWorkDir = (dir,opts,cb)=>{
    let cmd = null;
    if (opts.init) {
        cmd = opts.init;
    } else if (fs.existsSync(path.join(dir,'package.json'))) {
        cmd = "npm install";
    } else if (fs.existsSync(path.join(dir,'Makefile'))) {
        cmd = "make install";
    } else if (fs.existsSync(path.join(dir,'setup.py'))) {
        cmd = "python setup.py build";
    }
    if (cmd) {
        process.stdout.write(`${dir}$ ${cmd}\n`);
        cp.exec(cmd,{
            cwd:dir
        },(err,stdout,stderr)=>{
            process.stdout.write(stdout);
            process.stdout.write(stderr);
            cb(err);
        });
    } else {
        process.stderr.write("no initialisation performed\n");
        cb(null);
    }
};

const systemctl = (args,cb)=>{
    cp.execFile('sudo',
                ['systemctl'].concat(args),
               cb);
};

const deploy = exports.deploy = (base,commit,opts)=>{
    const     repoDir = path.join(base,'repo.git');
    const versionsDir = path.join(base,'versions');
    const   commitDir = path.join(versionsDir,commit);
    const     workDir = path.join(commitDir,'work');
    const currentLink = path.join(base,'current');
    if (!fs.existsSync(versionsDir))
        fs.mkdirSync(versionsDir);
    assert(!fs.existsSync(commitDir));
    assert(!fs.existsSync(workDir));
    fs.mkdirSync(commitDir);
    fs.mkdirSync(workDir);
    cp.execFile('git',[
        '--git-dir',repoDir,
        '--work-tree',workDir,
        'checkout','-f',commit],
                (err)=>{
                    if (err)
                        throw err;
                    initVersionWorkDir(workDir,opts,(err)=>{
                        if (err)
                            throw err;
                        const services = getAffectedServices(base,commit,opts);
                        if (services.length>0)
                            systemctl(['stop','--wait'].concat(services),
                                      (err1)=>{
                                          if (err1)
                                              throw err1;
                                          if (fs.existsSync(currentLink))
                                              fs.unlinkSync(currentLink);
                                          fs.symlinkSync(commitDir,currentLink);
                                          cp.execSync("sudo systemctl daemon-reload");
                                          systemctl(['start'].concat(services),
                                                    (err2)=>{
                                                        if (err2)
                                                            throw err2;
                                                    } );
                                      });
                    });
                });
};

const main = exports.main = (argv)=>{
    const     opts = {};
    const argparse = new (require('argparse').ArgumentParser)({
        addHelp:     true,
        description: require('./package.json').description
    });
    argparse.addArgument(
        ['-d','--directory'],
        {
            action: 'store',
            help:   "base directory"
        }
    );

    const subparsers = argparse.addSubparsers({
        title: 'subcommands',
        dest:  'subcommandName'
    });
    const subcommands = {};
    const addSubcommand = (name,opts)=>{
        return subcommands[name] = subparsers.addParser(name,opts);
    };

    addSubcommand('post-receive-hook',{addHelp:true});
    subcommands['post-receive-hook'].addArgument(
        ['--init'],
        {
            action:       'store',
            help:         "command to run to init new version"
        }
    );
    subcommands['post-receive-hook'].addArgument(
        ['--systemd-directories'],
        {
            action:       'store',
            help:         "locations of systemd unit files",
            defaultValue: '/etc/systemd/system:/lib/systemd/system:/usr/lib/systemd/system:/etc/init.d',
            type:         (s)=>s.split(':'),
            dest:         'systemdDirs'
        }
    );
    subcommands['post-receive-hook'].addArgument(
        ['--apache2-directories'],
        {
            action:       'store',
            help:         "locations of systemd unit files",
            defaultValue: '/etc/apache2/:/var/www',
            type:         (s)=>s.split(':'),
            dest:         'apache2Dirs'
        }
    );
    subcommands['post-receive-hook'].exec = ()=>{
        const  dir = args.directory || process.cwd();
        const base = findDeploymentBase(dir);
        let  stdin = '';
        let commit = null;
        process.stdin.on('data',(chunk)=>{
            stdin += chunk.toString('utf8');
        });
        process.stdin.on('end',()=>{
            stdin.split('\n').forEach((l)=>{
                const tokens = l.split(' ');
                if (tokens[2]==='refs/heads/master')
                    commit = tokens[1];
            });
            Object.assign(opts,args);
            opts.isServiceRunning = isServiceRunning;
            if (commit!==null)
                deploy(base,commit,opts);
        });
        assert.notStrictEqual(base,null);
    };
    addSubcommand('init',{addHelp:true});
    subcommands.init.exec = ()=>{
        const        base = args.directory || process.cwd();
        const     repoDir = path.join(base,'repo.git');
        const    hookFile = path.join(repoDir,'hooks/post-receive');
        const         bin = Object.keys(require('./package.json').bin)[0]; // !!!
        if (!fs.existsSync(repoDir)) {
            fs.mkdirSync(repoDir);
            cp.execSync(`git --git-dir=${repoDir} init --bare --shared=group`);
        }
        fs.writeFileSync( hookFile,"#!/bin/sh");
        fs.appendFileSync(hookFile,`${bin} post-receive-hook`);
        fs.mkdirSync(path.join(base,'versions'));
    };

    const  args = argparse.parseArgs(argv);
    if (subcommands[args.subcommandName]===undefined)
        throw new VError("unknown subcommand: %s",args.subcommandName);
    if (subcommands[args.subcommandName].exec===undefined)
        throw new VError("NYI: subcommand `%s`",args.subcommandName);
    subcommands[args.subcommandName].exec(args);
}

if (require.main===module) {
    try {
        main();
    } catch (e) {
        throw e;                // !!! TESTING !!!
        //console.log("failed: %s",e.message);
        //process.exit(1);
    }
}
