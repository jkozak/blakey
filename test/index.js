"use strict";

const  index = require('../index.js');

const     cp = require('child_process');
const     fs = require('fs');
const   path = require('path');
const   temp = require('temp').track();
const   util = require('util');
const assert = require('chai').assert;

describe("init",function(){
    it("initialises",function(){
        const tempDir = temp.mkdirSync();
        index.main(['-d',tempDir,'init']);
        assert(fs.existsSync(path.join(tempDir,'repo.git/hooks')));
        assert(fs.existsSync(path.join(tempDir,'versions')));
    });
});

describe("findLinksTo",function(){
    it("finds links",function(){
        const tempDir = temp.mkdirSync();
        fs.mkdirSync(path.join(tempDir,'systemd'));
        fs.mkdirSync(path.join(tempDir,'version'));
        cp.execSync(util.format("touch %s",path.join(tempDir,'version/t1')));
        fs.symlinkSync(path.join(tempDir,'version/t1'),path.join(tempDir,'systemd/t1'));
        assert.deepEqual(index.findLinksTo(path.join(tempDir,'systemd'),
                                           path.join(tempDir,'version')),
                         ['t1']);
    });
    it("finds links in subdirs",function(){
        const tempDir = temp.mkdirSync();
        fs.mkdirSync(path.join(tempDir,'systemd'));
        fs.mkdirSync(path.join(tempDir,'systemd/system'));
        fs.mkdirSync(path.join(tempDir,'version'));
        cp.execSync(util.format("touch %s",path.join(tempDir,'version/t1')));
        fs.symlinkSync(path.join(tempDir,'version/t1'),path.join(tempDir,'systemd/system/t1'));
        assert.deepEqual(index.findLinksTo(path.join(tempDir,'systemd'),
                                           path.join(tempDir,'version')),
                         ['system/t1']);
    });
});

describe("getAffectedServices",function(){
    it("returns running services",function(){
        const tempDir = temp.mkdirSync();
        const sysdDir = path.join(tempDir,'systemd');
        const versDir = path.join(tempDir,'version');
        fs.mkdirSync(sysdDir);
        fs.mkdirSync(path.join(sysdDir,'system'));
        fs.mkdirSync(versDir);
        cp.execSync(util.format("touch %s",path.join(tempDir,'version/t1.service')));
        fs.symlinkSync(path.join(tempDir,'version/t1'),path.join(tempDir,'systemd/system/t1.service'));
        assert.deepEqual(index.getAffectedServices(versDir,
                                                   '',
                                                   {
                                                       isServiceRunning:()=>true,
                                                       apache2Dirs:     [],
                                                       systemdDirs:     [sysdDir]
                                                   }),
                         ['t1.service']);
    });
    it("ignores stopped services",function(){
        const tempDir = temp.mkdirSync();
        const sysdDir = path.join(tempDir,'systemd');
        const versDir = path.join(tempDir,'version');
        fs.mkdirSync(sysdDir);
        fs.mkdirSync(path.join(sysdDir,'system'));
        fs.mkdirSync(versDir);
        cp.execSync(util.format("touch %s",path.join(tempDir,'version/t1.service')));
        fs.symlinkSync(path.join(tempDir,'version/t1'),path.join(tempDir,'systemd/system/t1.service'));
        assert.deepEqual(index.getAffectedServices(versDir,
                                                   '',
                                                   {
                                                       isServiceRunning:()=>false,
                                                       apache2Dirs:     [],
                                                       systemdDirs:     [sysdDir]
                                                   }),
                         []);
    });
    it("only finds own services",function(){
        const tempDir = temp.mkdirSync();
        const sysdDir = path.join(tempDir,'systemd');
        const versDir = path.join(tempDir,'version');
        const ver2Dir = path.join(tempDir,'version2');
        fs.mkdirSync(sysdDir);
        fs.mkdirSync(path.join(sysdDir,'system'));
        fs.mkdirSync(versDir);
        fs.mkdirSync(ver2Dir);
        cp.execSync(util.format("touch %s",path.join(ver2Dir,'t1.service')));
        fs.symlinkSync(path.join(ver2Dir,'/t1.service'),path.join(sysdDir,'system/t1.service'));
        assert.deepEqual(index.getAffectedServices(ver2Dir,
                                                   '',
                                                   {
                                                       isServiceRunning:()=>true,
                                                       apache2Dirs:     [],
                                                       systemdDirs:     [sysdDir]
                                                   }),
                         ['t1.service']);
        assert.deepEqual(index.getAffectedServices(versDir,
                                                   '',
                                                   {
                                                       isServiceRunning:()=>true,
                                                       apache2Dirs:     [],
                                                       systemdDirs:     [sysdDir]
                                                   }),
                         []);
    });
});
