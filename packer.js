#!/usr/bin/env node
var path = require("path"),
    packer = require("./soe-pack.js"),
    mode = process.argv[2],
    excludeFiles = ["Assets_256.pack"];

switch (mode) {
    case "pack":
        var inPath = process.argv[3],
            outPath = process.argv[4];
        if (!outPath) {
            outPath = "Assets_" + Date.now() + ".pack";
        }
        console.log("Packing assets in " + inPath + " to file " + outPath);
        packer.pack(inPath, outPath);
        console.log("Done!");
        break;
    case "manifest":
        var inPath = process.argv[3],
            outFile = process.argv[4];
        if (!outFile) {
            outFile = "manifest_" + Date.now() + ".txt";
        }
        packer.manifest(inPath, outFile, excludeFiles);
        break;
    case "diff":
        var oldManifest = process.argv[3],
            newManifest = process.argv[4],
            outFile = process.argv[5];
        if (!outFile) {
            outFile = "diff_" + Date.now() + ".json";
        }
        packer.diff(oldManifest, newManifest, outFile);
        break;
    case "extractall":
        var inPath = process.argv[3],
            outPath = process.argv[4];
        packer.extractAll(inPath, outPath, excludeFiles);
        break;
    case "extractpack":
        var inPath = process.argv[3],
            outPath = process.argv[4];
        packer.extractPack(inPath, outPath, excludeFiles);
        break;
    case "extractdiff":
        var diffPath = process.argv[3],
            packPath = process.argv[4],
            outPath = process.argv[5];
        packer.extractDiff(diffPath, packPath, outPath, excludeFiles);
        break;
    case "extract":
        var inPath = process.argv[3],
            file = process.argv[4],
            outPath = process.argv[5];
        packer.extractFile(inPath, file, outPath, excludeFiles);
        break;
    case "extractregexp":
        var inPath = process.argv[3],
            file = process.argv[4],
            outPath = process.argv[5];
        packer.extractFile(inPath, file, outPath, excludeFiles, true);
        break;
    case "append":
        var inFile1 = process.argv[3],
            inFile2 = process.argv[4],
            outFile = process.argv[5];
        packer.append(inFile1, inFile2, outFile);
        break;
    case "check":
        //region check the file white space
        var infFilePath = process.argv[3];
            packName = process.argv[4];
        packer.check(infFilePath,
          (err,assets)=>
            {
            }
        );
        //endregion
        break;
  case "checkAll":
    var packsFileBasePath = process.argv[3];
    packer.checkAll(packsFileBasePath);
    break;
    default:
        console.log("Usage: node packer.js <mode> ...");
}

