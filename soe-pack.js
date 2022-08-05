var fs = require("fs"),
    path = require("path"),
    crc32 = require("buffer-crc32");

var MAXOPENFILES = 1000;

function writeUInt32BE(stream, number) {
    stream.write(new Buffer([
        number >> 24 & 0xff,
        number >> 16 & 0xff,
        number >> 8 & 0xff,
        number & 0xff
    ]));
}

function writeString(stream, string) {
    stream.write(string);
}

function readUInt32BE(fd, offset) {
    var buf = new Buffer(4);
    fs.readSync(fd, buf, 0, 4, offset);
    return buf.readUInt32BE(0);
}

function readString(fd, offset) {
    var len = readUInt32BE(fd, offset);
    var buf = new Buffer(len);
    fs.readSync(fd, buf, 0, len, offset+4);
    return buf.toString();
}

function listPackFiles(inPath, excludeFiles) {
    if (!fs.existsSync(inPath)) {
        throw "listPackFiles(): inPath does not exist";
    }
    var files = fs.readdirSync(inPath),
        packFiles = [];
    for (var i=0;i<files.length;i++) {
        if (/\.pack$/.test(files[i])) {
            if (!excludeFiles || excludeFiles.indexOf(files[i]) == -1) {
                packFiles.push(files[i]);
            }
        }
    }
    return packFiles;
}

function readPackFile(filePath, file, callback) {
    var assets = [], asset,
        fd, i, offset = 0,
        numAssets, nextOffset;

    filePath = path.join(filePath, file);
    fs.open(filePath, "r", function(err, fd) {
        do {
            nextOffset = readUInt32BE(fd, offset);
            offset += 4;
            numAssets = readUInt32BE(fd, offset);
            offset += 4;
            console.warn('next offset pos:', nextOffset, 'assets count is :', numAssets);
            for (i=0;i<numAssets;i++) {
                asset = {};
                asset.file = file;
                asset.name = readString(fd, offset);
                asset.name_lower = asset.name.toLowerCase();
                offset += asset.name.length + 4;
                asset.offset = readUInt32BE(fd, offset);
                offset += 4;
                asset.length = readUInt32BE(fd, offset);
                offset += 4;
                asset.crc32 = readUInt32BE(fd, offset);
                offset += 4;
                assets.push(asset);
            }
            offset = nextOffset;
        } while (nextOffset);
        fs.close(fd, function(err) {
            callback(err, assets);
        });
    });
}


function readPackFileFromBuffer(data, callback) {
    var assets = [], asset,
        fd, i, offset = 0,
        numAssets, nextOffset;
    do {
        nextOffset = data.readUInt32BE(offset);
        offset += 4;
        numAssets = data.readUInt32BE(offset);
        offset += 4;
        for (i=0;i<numAssets;i++) {
            asset = {};
            var namelength = data.readUInt32BE(offset);
            offset += 4;
            asset.name = data.toString("utf8", offset, offset + namelength);
            asset.name_lower = asset.name.toLowerCase();
            offset += namelength;
            asset.offset = data.readUInt32BE(offset);
            offset += 4;
            asset.length = data.readUInt32BE(offset);
            offset += 4;
            asset.crc32 = data.readUInt32BE(offset);
            offset += 4;
            asset.data = data.slice(asset.offset, asset.offset + asset.length);
            assets.push(asset);

        }
        offset = nextOffset;
    } while (nextOffset);
    callback(null, assets);
}

function append(inFile1, inFile2, outFile) {
    if (!fs.existsSync(inFile1)) {
        throw "append(): inFile1 does not exist";
    }
    if (!fs.existsSync(inFile2)) {
        throw "append(): inFile2 does not exist";
    }

    var data1 = fs.readFileSync(inFile1),
        data2 = fs.readFileSync(inFile2),
        outData = new Buffer(data1.length + data2.length),
        offset = 0, appendOffset = 0,
        numAssets,
        nextOffset = 0, nextAppendOffset;

    console.log("Appending " + data2.length + " bytes to " + inFile1);

    data1.copy(outData, 0, 0, data1.length);
    data2.copy(outData, data1.length, 0, data2.length);

    do {
        offset = nextOffset;
        nextOffset = data1.readUInt32BE(offset);
    } while (nextOffset);

    appendOffset = data1.length;
    outData.writeUInt32BE(appendOffset, offset);

    console.log("Rewriting offsets");
    offset = 0;
    do {
        nextOffset = data2.readUInt32BE(offset);
        outData.writeUInt32BE(nextOffset ? appendOffset + nextOffset : 0, appendOffset + offset);
        offset += 4;

        numAssets = data2.readUInt32BE(offset);
        offset += 4;

        for (i=0;i<numAssets;i++) {
            offset += data2.readUInt32BE(offset) + 4;
            outData.writeUInt32BE(appendOffset + data2.readUInt32BE(offset), appendOffset + offset);
            offset += 12;
        }
        offset = nextOffset;
    } while (nextOffset);

    fs.writeFileSync(outFile, outData);
}

function manifest(inPath, outFile, excludeFiles) {
    var files, file, ext, str,
        i, j, packAssets,
        assets = [],
        asset;

    files = listPackFiles(inPath, excludeFiles);
    console.log("Reading assets from " + files.length + " packs");
    function readNextFile() {
        if (files.length) {
            var file = files.shift();
            process.stdout.write(".");
            readPackFile(inPath, file, function(err, packAssets) {
                assets = assets.concat(packAssets);
                readNextFile();
            });
        } else {
            process.stdout.write("\r\n");
            console.log("Writing manifest to " + outFile);
            assets = assets.sort(function(a, b) {
                return a.name_lower < b.name_lower ? -1 : 1;
            });
            str = [["CRC32", "NAME", "PACK", "OFFSET", "LENGTH"].join("\t")];
            for (j=0;j<assets.length;j++) {
                asset = assets[j];
                str[j+1] = [asset.crc32, asset.name, asset.file, asset.offset, asset.length].join("\t");
            }
            fs.writeFile(outFile, str.join("\r\n"), function(err) {
                if (err) {
                    throw err;
                }
                console.log("Done!");
            });
        }
    }
    readNextFile();
}

function readManifest(file) {
    if (!fs.existsSync(file)) {
        throw "readManifest(): file does not exist";
    }

    var data = fs.readFileSync(file).toString(),
        lines = data.split("\r\n"),
        values,
        assets = {};
    for (var i=1;i<lines.length;i++) {
        values = lines[i].split("\t");
        assets[values[1]] = {
            name: values[1],
            crc32: parseInt(values[0], 10),
            pack: values[2],
            offset: parseInt(values[3], 10),
            length: parseInt(values[4], 10)
        };
    }
    return assets;
}

function diff(oldManifestPath, newManifestPath, outFile) {
    var oldManifest, newManifest, a,
        changes = {
            added: [],
            deleted: [],
            modified: [],
            packChanged: 0,
            offsetChanged: 0
        };

    oldManifest = readManifest(oldManifestPath);
    newManifest = readManifest(newManifestPath);

    for (a in newManifest) {
        if (newManifest.hasOwnProperty(a)) {
            if (oldManifest[a]) {
                if (newManifest[a].crc32 != oldManifest[a].crc32) {
                    changes.modified.push(newManifest[a]);
                } else if (newManifest[a].pack != oldManifest[a].pack) {
                    changes.packChanged++;
                    //changes.packChanged.push(newManifest[a]);
                } else if (newManifest[a].offset != oldManifest[a].offset) {
                    changes.offsetChanged++;
                    //changes.offsetChanged.push(newManifest[a]);
                }
            } else {
                changes.added.push(newManifest[a]);
            }
        }
    }
    for (a in oldManifest) {
        if (oldManifest.hasOwnProperty(a)) {
            if (!newManifest[a]) {
                changes.deleted.push(oldManifest[a]);
            }
        }
    }

    console.log("Writing manifest changes to " + outFile);
    fs.writeFileSync(outFile, JSON.stringify(changes, null, 4));
}

function pack(inPath, outPath) {
    var packBuffer = new Buffer(0),
        folderHeaderBuffer,
        fileDataBuffer,
        fileHeaderBuffer,
        i, j, nextOffset, files, stat,
        fileOffset, dataOffset, data,
        fileHeaderLength, dataLength,
        folders, collections = [], collectionFolder;

    if (!fs.existsSync(inPath)) {
        throw "pack(): inPath does not exist [" + inPath + "]";
    }

    if (fs.existsSync(outPath)) {
        stat = fs.statSync(outPath);
        if (stat.isDirectory()) {
            throw "pack(): outPath is a directory [" + outPath + "]";
        }
    }

    folders = fs.readdirSync(inPath);
    for (i=0;i<folders.length;i++) {
        collectionFolder = path.join(inPath, folders[i]);
        stat = fs.statSync(collectionFolder);
        if (stat.isDirectory()) {
            files = fs.readdirSync(collectionFolder);
            collections.push({
                folder: collectionFolder,
                files: files
            });
        }
    }

    for (i=0;i<collections.length;i++) {
        files = collections[i].files;
        collectionFolder = collections[i].folder;
        fileHeaderLength = 0;
        dataLength = 0;
        for (j=0;j<files.length;j++) {
            fileHeaderLength += 16 + files[j].length;
            stat = fs.statSync(path.join(collectionFolder, files[j]));
            dataLength += stat.size;
        }

        folderHeaderBuffer = new Buffer(8);
        fileDataBuffer = new Buffer(dataLength);
        fileHeaderBuffer = new Buffer(fileHeaderLength);

        fileOffset = 0;
        dataOffset = 0;

        for (j=0;j<files.length;j++) {
            data = fs.readFileSync(path.join(collectionFolder, files[j]));

            fileHeaderBuffer.writeUInt32BE(files[j].length, fileOffset);
            fileHeaderBuffer.write(files[j], fileOffset + 4, files[j].length);
            fileHeaderBuffer.writeUInt32BE(packBuffer.length + folderHeaderBuffer.length + fileHeaderBuffer.length + dataOffset, fileOffset + files[j].length + 4);
            fileHeaderBuffer.writeUInt32BE(data.length, fileOffset + files[j].length + 8);
            fileHeaderBuffer.writeUInt32BE(crc32.unsigned(data), fileOffset + files[j].length + 12);

            fileOffset += 16 + files[j].length;

            data.copy(fileDataBuffer, dataOffset, 0);
            dataOffset += data.length;
        }

        if (i < collections.length-1) {
            nextOffset = packBuffer.length + folderHeaderBuffer.length + fileHeaderBuffer.length + fileDataBuffer.length;
        } else {
            nextOffset = 0;
        }

        folderHeaderBuffer.writeUInt32BE(nextOffset, 0);
        folderHeaderBuffer.writeUInt32BE(files.length, 4);

        packBuffer = Buffer.concat([packBuffer, folderHeaderBuffer, fileHeaderBuffer, fileDataBuffer]);
    }
    fs.writeFileSync(outPath, packBuffer);
    return true;
}

function packFromBuffers(files) {
    var packBuffer = new Buffer(0),
        folderHeaderBuffer,
        fileDataBuffer,
        fileHeaderBuffer,
        i, j, nextOffset, stat,
        fileOffset, dataOffset, data,
        fileHeaderLength, dataLength, nameLength;

    fileHeaderLength = 0;
    dataLength = 0;

    for (j=0;j<files.length;j++) {
        fileHeaderLength += 16 + files[j].name.length;
        dataLength += files[j].data.length;
    }

    folderHeaderBuffer = new Buffer(8);
    fileDataBuffer = new Buffer(dataLength);
    fileHeaderBuffer = new Buffer(fileHeaderLength);

    fileOffset = 0;
    dataOffset = 0;

    for (j=0;j<files.length;j++) {
        data = files[j].data;
        nameLength = files[j].name.length;
        fileHeaderBuffer.writeUInt32BE(nameLength, fileOffset);
        fileHeaderBuffer.write(files[j].name, fileOffset + 4, nameLength);
        fileHeaderBuffer.writeUInt32BE(packBuffer.length + folderHeaderBuffer.length + fileHeaderBuffer.length + dataOffset, fileOffset + nameLength + 4);
        fileHeaderBuffer.writeUInt32BE(data.length, fileOffset + nameLength + 8);
        fileHeaderBuffer.writeUInt32BE(crc32.unsigned(data), fileOffset + nameLength + 12);

        fileOffset += 16 + nameLength;

        data.copy(fileDataBuffer, dataOffset, 0);
        dataOffset += data.length;
    }
    nextOffset = 0;

    folderHeaderBuffer.writeUInt32BE(nextOffset, 0);
    folderHeaderBuffer.writeUInt32BE(files.length, 4);

    var finalData = new Buffer(packBuffer.length + folderHeaderBuffer.length + fileHeaderBuffer.length + fileDataBuffer.length);
    packBuffer.copy(finalData, 0, 0);
    folderHeaderBuffer.copy(finalData, packBuffer.length, 0);
    fileHeaderBuffer.copy(finalData, packBuffer.length + folderHeaderBuffer.length, 0);
    fileDataBuffer.copy(finalData, packBuffer.length + folderHeaderBuffer.length + fileHeaderBuffer.length, 0);
    return finalData;
}

function extractDiff(diffPath, packPath, outPath, excludeFiles) {
    if (!fs.existsSync(packPath)) {
        throw "extractDiff(): packPath does not exist: " + packPath;
    }
    if (!fs.existsSync(outPath)) {
        throw "extractDiff(): outPath does not exist";
    }
    if (!fs.existsSync(diffPath)) {
        throw "extractDiff(): diffPath does not exist";
    }

    var packs = {},
        packStack = [];

    function openPack(file, callback) {
        if (packs[file]) {
            callback(null, packs[file]);
            return;
        }
        fs.open(file, "r", function(err, fd) {
            packs[file] = fd;
            packStack.push(file);
            if (packStack.length > MAXOPENFILES) {
                var firstPack = packStack.shift(),
                    firstFd = packs[firstPack];
                    delete packs[firstPack];
                if (firstFd) {
                    fs.close(firstFd, function(err) {
                        callback(err, fd);
                    });
                } else {
                    callback(err, fd);
                }
            } else {
                callback(err, fd);
            }
        });
    }

    function extractAssets(assets, outPath, callback) {
        fs.mkdir(outPath, function(err) {
            function nextAsset() {
                if (assets.length === 0) {
                    callback();
                    return;
                }
                var asset = assets.shift(),
                    packName = asset.pack.replace(".pack", "");
                console.log("Extracting " + asset.name + " from " + asset.pack);
                fs.mkdir(outPath, function(err) {
                    openPack(path.join(packPath, asset.pack), function(err, fd) {
                        var buffer = new Buffer(asset.length);
                        fs.read(fd, buffer, 0, asset.length, asset.offset, function(err) {
                            fs.writeFile(path.join(outPath, asset.name), buffer, function(err) {
                                nextAsset();
                            });
                        });
                    });
                });
            }
            nextAsset();
        });
    }


    function closePacks(callback) {
        if (packStack.length) {
            var pack = packStack.shift(),
                packFd = packs[pack];
            delete packs[pack];
            if (packFd) {
                console.log("Closing " + pack);
                fs.close(packFd, function() {
                    closePacks(callback);
                });
            } else {
                closePacks(callback);
            }
        } else {
            callback();
        }
    }

    console.log("Reading diff: " + diffPath);
    fs.readFile(diffPath, function(err, data) {
        if (err) {
            throw err;
        }
        var diff = JSON.parse(data);
        extractAssets(diff.added.slice(), path.join(outPath, "added"), function() {
            extractAssets(diff.modified.slice(), path.join(outPath, "modified"), function() {
                closePacks(function() {
                    console.log("All done!");
                });
            });
        });
    });
}

function extractAll(inPath, outPath, excludeFiles) {
    var startTime = Date.now(),
        totalAssets = 0;
        packs = listPackFiles(inPath, excludeFiles);

    if (!fs.existsSync(outPath)) {
        throw "extractAll(): outPath does not exist";
    }

    console.log("Reading pack files in " + inPath);

    function nextPack() {
        if (!packs.length) {
            console.log("Extracted " + totalAssets + " assets in " + ((Date.now() - startTime) / 1000).toFixed(2) + " seconds.");
            return;
        }

        var pack = packs.shift(),
            packPath = path.join(outPath, pack.replace(".pack", ""));

        if (!fs.existsSync(packPath)) {
            fs.mkdirSync(packPath);
        }

        readPackFile(inPath, pack, function(err, assets) {
            console.log("Extracting " + assets.length + " assets from " + pack);
            var asset, n = assets.length;
            fs.readFile(path.join(inPath, pack), function(err, data) {
                for (var i=0;i<assets.length;i++) {
                    asset = assets[i];
                    fs.writeFile(path.join(packPath, asset.name), data.slice(asset.offset, asset.offset+asset.length),
                        function() {
                            totalAssets++;
                            if (--n === 0) {
                                nextPack();
                            }
                        }
                    );
                }
            });
        });
    }
    nextPack();
}

function extractPack(inPath, outPath) {
    var startTime = Date.now();

    if (!fs.existsSync(outPath)) {
        throw "extractPack(): outPath does not exist";
    }

    //console.log("Reading pack file: " + inPath);

    readPackFile("", inPath, function(err, assets) {
        //console.log("Extracting " + assets.length + " assets from pack file");
        var asset, n = assets.length;
        fs.readFile(inPath, function(err, data) {
            for (var i=0;i<assets.length;i++) {
                asset = assets[i];
                fs.writeFile(path.join(outPath, asset.name), data.slice(asset.offset, asset.offset+asset.length),
                    function() {}
                );
            }
        });
    });
}


function extractToBuffers(data, callback) {
    readPackFileFromBuffer(data, function(err, assets) {
        callback(err, assets);
    });
}


function extractFile(inPath, file, outPath, excludeFiles, useRegExp, callback) {
    var packs = listPackFiles(inPath, excludeFiles),
        assets, buffer, fd, re, numFound,
        i, j;
    if (!outPath) {
        outPath = ".";
    }
    console.log("Reading pack files in " + inPath);
    if (useRegExp) {
        re = new RegExp(file);
    }
    numFound = 0;
    function nextPack() {
        if (packs.length) {
            var pack = packs.shift(),
                assets;
            readPackFile(inPath, pack, function(err, assets) {
                for (var j=0;j<assets.length;j++) {
                    var isMatch = false;
                    if (useRegExp) {
                        isMatch = re.test(assets[j].name);
                    } else if (assets[j].name == file) {
                        isMatch = true;
                    }
                    if (isMatch) {
                        numFound++;
                        console.log("Extracting file " + assets[j].name + " from " + pack);
                        fd = fs.openSync(path.join(inPath, pack), "r");
                        buffer = new Buffer(assets[j].length);
                        fs.readSync(fd, buffer, 0, assets[j].length, assets[j].offset);
                        fs.closeSync(fd);
                        fs.writeFileSync(path.join(outPath, assets[j].name), buffer);
                    }
                }
                nextPack();
            });
        } else {
            if (numFound) {
                console.log("Extracted " + numFound + " matching asset" + (numFound > 1 ? "s" : ""));
            } else {
                console.log("No matching assets found");
            }
            if (callback) {
                callback();
            }
        }
    }
    nextPack();
}

/*
开头的4字节表示游戏读取文件名时候的基地址.
接下来的4字节表示当前文件中的资源数量

然后开始循环

4字节表示接下来的文件名的长度
然后就是文件名,带扩展名
接下来4字节是该包中,该资源的起始位置
再接下来4字节是该资源的长度
再接下来4字节是资源的crc32校验.如果crc32校验不对的话,加载资源会失败.本工具中的crc32是正确的,网上的不对.

包文件不能太短(可能是) 基于031文件修改的话,把前面的都用11填充,然后用多少写多少,是可以用的.
但是直接写一个比较小的3kb的文件里面只包含一个adr的话,是失败的.
做好的包按照名字顺序放在资源目录 比如第一个自己做的包是Asset_256.pack
游戏运行时候会自动加载新包
* */
function check(fileFullPath, callback) {
  var assets = [], asset,
    fd, i, offset = 0,
    numAssets, nextOffset;

  // filePath = path.join(filePath, file);
  fs.open(fileFullPath, "r", function(err, fd) {
    do {
      nextOffset = readUInt32BE(fd, offset);
      var nextOffsetHex = nextOffset.toString(16);
      offset += 4;
      numAssets = readUInt32BE(fd, offset);
      var numAssetsHex = numAssets.toString(16);
      offset += 4;
      console.warn('next offset pos:', nextOffset, 'assets count is :', numAssets);
      for (i=0;i<numAssets;i++) {
        asset = {};
        // asset.file = file;
        asset.name = readString(fd, offset);
        asset.name_lower = asset.name.toLowerCase();
        offset += asset.name.length + 4;
        asset.offset = readUInt32BE(fd, offset);
        offset += 4;
        asset.length = readUInt32BE(fd, offset);
        offset += 4;
        asset.crc32 = readUInt32BE(fd, offset);
        offset += 4;

        //读取文件的buf
        var buf = new Buffer(asset.length);
        fs.readSync(fd, buf, 0, buf.length, asset.offset);
        var checkCrc = crc32.unsigned(buf);
        var bufStr = buf.toString();
        if (checkCrc !== asset.crc32)
        {
          console.log('crc校验不一致')
        }

        assets.push(asset);
      }
      offset = nextOffset;
    } while (nextOffset);


    let asc = function (a,b)
    {
      return a["offset"] > b["offset"]? 1:-1;
    }
    assets.sort(asc);
    let lastEnd = 0;
    console.log('Total assets count:', assets.length);

    for (let i = 0; i < assets.length; i++) {
      //当前文件
      let current = assets[i];
      //当前文件开始
      let currentStart = current.offset;
      //当前文件结束
      let currentEnd = Number(current.offset + current.length);
      //该文件和上一个文件中间的空余空间长度
      let emptyLength = currentStart - lastEnd;
      //如果空出来长度了
      if(emptyLength === 0)
      {
        continue;
      }
      //从空出来的地方 也就是上一个文件的结尾
      let emptyFileStart = lastEnd;
      //空出来的地方那个文件有多长
      let emptyFileLength = currentStart - lastEnd;
      //空出来的那个地方的那个文件的结尾处的索引,应该用不到.
      let emptyFileEnd = currentStart-1;
      //从空出来的地方读取4个,猜测一下格式
      let extLen = 4;
      var buf = new Buffer(extLen);
      fs.readSync(fd, buf, 0, extLen, emptyFileStart);
      let guessFileExtName = buf.toString();
      // console.log(guessFileExtName);
      //读取空文件长度的字符,保存起来
      let emptySpaceBuf = new Buffer(emptyFileLength);
      fs.readSync(fd,emptySpaceBuf, 0, emptyFileLength, emptyFileStart);

      // if (guessFileExtName.toLowerCase().substr(0,3) !== '<ac')
      // {
      //   lastEnd = currentEnd;
      //   continue;
      // }
      //
      // var packFilePath = path.dirname(fileFullPath);
      // var packFileName = path.basename(fileFullPath);
      // var packExtPos = packFileName.indexOf(".pack");
      // packFileName = packFileName.substring(0,packExtPos);
      // var ddsDestPath = path.join(packFilePath, packFileName);
      // var ddsDestFullPath  =  path.join(ddsDestPath, packFileName + '_' + i+'.adr');
      // if (!fs.existsSync(ddsDestPath)) {
      //   fs.mkdirSync(ddsDestPath);
      // }
      //
      // fs.writeFileSync(ddsDestFullPath,
      //   emptySpaceBuf
      // );


      console.log(
        "此文件前空余处文件类型", guessFileExtName,
        "此文件前空余空间共:", emptyLength,
        emptyLength.toString(16),
        '\t || \t此文件开始:', currentStart.toString(16),
        "此文件结束:", currentEnd.toString(16),
        "\t\t" +current.name
      );
      lastEnd = currentEnd;
    }


    fs.close(fd, function(err) {
      callback(err, assets);
    });
  });
}

function checkAll(packsFileBasePath)
{
  let files = listPackFiles(packsFileBasePath, null);
  for (let i = 0; i < files.length; i++) {
    let current = path.join(packsFileBasePath, files[i]);
    check(current, ()=>{
      console.log('解析第'+ (i+1)+ '个文件完成');
    })
  }
}

exports.pack = pack;
exports.packFromBuffers = packFromBuffers;
exports.extractAll = extractAll;
exports.extractPack = extractPack;
exports.extractToBuffers = extractToBuffers;
exports.extractDiff = extractDiff;
exports.extractFile = extractFile;
exports.diff = diff;
exports.append = append;
exports.manifest = manifest;
exports.check = check;
exports.checkAll = checkAll;
