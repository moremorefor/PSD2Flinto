 //
// Copyright (c) 2015 more_more_for
//

#target photoshop
app.bringToFront();

#include "js/json2.js"
#include "js/xorshift.js"
#include "js/uuid.js"

preferences.rulerUnits = Units.PIXELS;

///////////////////////////////////////////////////////////////////////////////
// Settings
///////////////////////////////////////////////////////////////////////////////
var alwaysOverwrite = false;
var scaleFactor = 2.0;

///////////////////////////////////////////////////////////////////////////////
// Variables
///////////////////////////////////////////////////////////////////////////////
var d = activeDocument;
var documentName;
var metadata = {};
var metadata_doc = {};
var metadata_layers;

var folder;
var exportFolder;
var docFolder;

main();

///////////////////////////////////////////////////////////////////////////////
// Main
///////////////////////////////////////////////////////////////////////////////
function main() {
  try {
    touchUpLayerSelection();
  } catch (e) {}

  file = selectFolder(d.path, d.name.split(".")[0]);
  if (!file) {
    return;
  }

  exportFolder = new Folder(file.fsName);
  var result = createFolder(exportFolder);
  if (!result) {
    return;
  }

  documentName = file.name.split(".")[0];

  process_doc();
  metadata["width"] = parseInt(d.width, 10);
  metadata["height"] = parseInt(d.height, 10);
  metadata["scale"] = scaleFactor;
  metadata["screens"] = [metadata_doc];

  json = JSON.stringify(metadata, null, "\t");
  writeToFile(json, exportFolder.fsName + "/metadata.json");

  var execFile = new File(exportFolder.fsName);
  execFile.execute();
}

function process_doc() {
  metadata_doc["x"] = 0;
  metadata_doc["y"] = 0;
  metadata_doc["id"] = UUID.generate();
  metadata_doc["name"] = documentName;
  metadata_doc["layers"] = [];

  docFolder = new Folder(exportFolder + "/" + metadata_doc["id"]);
  var result = createFolder(docFolder);
  if (!result) {
    return;
  }

  var originDoc = d;
  d = d.duplicate();
  var layers = d.layers;
  process_layers(layers, metadata_doc["layers"]);
  d.close(SaveOptions.DONOTSAVECHANGES);
  d = originDoc;
}

function process_layers(layers, metadata) {
  for (var i = layers.length - 1; i >= 0; i--) {
    var layer = layers[i];
    if (layer.typename == "LayerSet") {
      if (layer.visible) process_layerSet(layer, metadata);
    } else if (layer.typename == "ArtLayer") {
      if (layer.visible) process_artLayer(layer, metadata);
    } else {
      // $.writeln("not found");
    }
  }
}

function process_layerSet(layerSet, metadata) {
  d.activeLayer = layerSet;
  unlockLayer(layerSet);

  var recursiveFlag = true;
  if (hasVectorMask()) {
    recursiveFlag = false;
    process_vectorMask();
  }
  if (hasLayerMask()) {
    recursiveFlag = false;
    process_layerMask();
  }
  //if ( hasFilterMask() )

  if (recursiveFlag) {
    var data = generate_metadata(layerSet);
    data["type"] = "group";
    data["layers"] = [];
    metadata.push(data);

    var layers = layerSet.layers;
    process_layers(layers, data["layers"]);
  } else {
    exportLayer(d.activeLayer, metadata);
  }
}

function process_artLayer(layer, metadata) {
  d.activeLayer = layer;
  unlockLayer(layer);

  if (hasVectorMask()) process_vectorMask();
  if (hasLayerMask()) process_layerMask();
  if (layer.kind == LayerKind.TEXT) process_textLayer();
  //if ( hasFilterMask() )

  exportLayer(d.activeLayer, metadata);
}

function exportLayer(targetLayer, metadata) {
  var newDocName = "_export.psd";
  var newDoc = documents.add(d.width, d.height, 72.0, newDocName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
  activeDocument = d;
  targetLayer.duplicate(newDoc, ElementPlacement.PLACEATBEGINNING);
  activeDocument = newDoc;
  var layer = newDoc.activeLayer;

  // metadata
  var data = generate_metadata(layer);
  data["type"] = "image";
  metadata.push(data);

  // trim
  newDoc.trim(TrimType.TRANSPARENT);

  // export
  var webFile = new File(docFolder + "/" + data["id"] + ".png");
  var webOpt = new ExportOptionsSaveForWeb();
  webOpt.format = SaveDocumentType.PNG;
  webOpt.PNG8 = false;
  newDoc.exportDocument(webFile, ExportType.SAVEFORWEB, webOpt);
  newDoc.close(SaveOptions.DONOTSAVECHANGES);

  activeDocument = d;
}

function process_vectorMask() {
  convertToSmartObject();
  rasterizeLayer();
}

function process_layerMask() {
  convertToSmartObject();
  rasterizeLayer();
}

function process_textLayer() {
  convertToSmartObject();
  rasterizeLayer();
}

function generate_metadata(layer) {
  var layObj = layer.bounds;
  var x = parseInt(layObj[0], 10);
  var y = parseInt(layObj[1], 10);
  var w = parseInt(layObj[2] - layObj[0], 10);
  var h = parseInt(layObj[3] - layObj[1], 10);
  var centerX = parseInt(x + w / 2, 10);
  var centerY = parseInt(y + h / 2, 10);
  var id = UUID.generate();
  var layerInfo = {
    "x": centerX,
    "y": centerY,
    "w": w,
    "h": h,
    "rotation": 0,
    "opacity": layer.opacity / 100,
    "id": id,
    "name": layer.name,
    "locked": false
  };
  return layerInfo;
}

///////////////////////////////////////////////////////////////////////////////
// Utils
///////////////////////////////////////////////////////////////////////////////
function unlockLayer(layer) {
  if (layer.isBackgroundLayer) layer.isBackgroundLayer = false;
  if (layer.positionLocked) layer.positionLocked = false;
  // can't unlock textlayer's pixelsLock
  if (layer.kind != LayerKind.TEXT) {
    if (layer.pixelsLocked) layer.pixelsLocked = false;
    if (layer.transparentPixelsLocked) layer.transparentPixelsLocked = false;
  }
  if (layer.allLocked) layer.allLocked = false;
}

function convertToSmartObject() {
  var idnewPlacedLayer = stringIDToTypeID("newPlacedLayer");
  executeAction(idnewPlacedLayer, undefined, DialogModes.NO);
}

///////////////////////////////////////////////////////////////////////////////
// File and Folder
///////////////////////////////////////////////////////////////////////////////
function createFolder(folderObj) {
  var result;
  if (!folderObj.exists) {
    result = folderObj.create();
    if (!result) {
      alert("Error: can't create file.");
      return false;
    }
  } else {
    result = confirmOverWrite(folderObj);
    if (!result) {
      alert("Canceled.");
      return false;
    }
  }

  return true;
}

function selectFolder(basepath, basename) {
  var baseFile = new File(basepath + "/" + basename);
  var fileObj = baseFile.saveDlg("Please input file name...");
  if (!fileObj) {
    alert("Canceled.");
    return;
  }

  var overlapIdx = fileObj.name.indexOf(".flinto");
  if (overlapIdx >= 0) {
    return fileObj;
  } else {
    fileObj = new File(fileObj.fsName + ".flinto");
    return fileObj;
  }
}

function confirmOverWrite(folderObj) {
  var files = folderObj.getFiles();
  if (files.length > 0) {
    if (!alwaysOverwrite) {
      if (confirm("The selected filename already exists.\nDo you want to overwrite the document?")) {
        recurciveDelete(folderObj);
      } else {
        return false;
      }
    } else {
      recurciveDelete(folderObj);
    }
  } else {
    if (!alwaysOverwrite) {
      if (confirm("The selected filename already exists.\nDo you want to overwrite the document?")) {
        folderObj.remove();
      } else {
        return false;
      }
    } else {
      folderObj.remove();
    }
  }

  return true;
}

function recurciveDelete(folderObj) {
  var files = folderObj.getFiles();
  for (var i = 0; i < files.length; i++) {
    if (!files[i].remove()) {
      recurciveDelete(files[i]);
    }
  }
  folderObj.remove();
}

function writeToFile(txt, savePath) {
  var fileObj = new File(savePath);
  fileObj.encoding = "UTF-8";

  var flag = fileObj.open("r");
  var existText;
  if (flag === true) {
    if (fileObj) {
      existText = fileObj.read();
    }
  }

  // overwrite
  flag = fileObj.open("w");
  if (flag === true) {
    var text;
    if (existText) {
      text = txt;
    } else {
      text = txt;
    }
    fileObj.writeln(text);
    fileObj.close();
  } else {
    alert("Error: can't create file.");
  }
}


/* ===================================================
// c2008 Adobe Systems, Inc. All rights reserved.
// Written by Jeffrey Tranberry
====================================================== */

///////////////////////////////////////////////////////////////////////////////
// Function: touchUpLayerSelection
// Usage: deal with odd layer selections of no layer selected or multiple layers
// Input: <none> Must have an open document
// Return: <none>
///////////////////////////////////////////////////////////////////////////////
function touchUpLayerSelection() {
  try {
    // Select all Layers
    var idselectAllLayers = stringIDToTypeID("selectAllLayers");
    var desc252 = new ActionDescriptor();
    var idnull = charIDToTypeID("null");
    var ref174 = new ActionReference();
    var idLyr = charIDToTypeID("Lyr ");
    var idOrdn = charIDToTypeID("Ordn");
    var idTrgt = charIDToTypeID("Trgt");
    ref174.putEnumerated(idLyr, idOrdn, idTrgt);
    desc252.putReference(idnull, ref174);
    executeAction(idselectAllLayers, desc252, DialogModes.NO);
    // Select the previous layer
    var idslct = charIDToTypeID("slct");
    var desc209 = new ActionDescriptor();
    var idnull = charIDToTypeID("null");
    var ref140 = new ActionReference();
    var idLyr = charIDToTypeID("Lyr ");
    var idOrdn = charIDToTypeID("Ordn");
    var idBack = charIDToTypeID("Back");
    ref140.putEnumerated(idLyr, idOrdn, idBack);
    desc209.putReference(idnull, ref140);
    var idMkVs = charIDToTypeID("MkVs");
    desc209.putBoolean(idMkVs, false);
    executeAction(idslct, desc209, DialogModes.NO);
  } catch (e) {
    // do nothing
  }
}

///////////////////////////////////////////////////////////////////////////////
// Function: hasLayerMask
// Usage: see if there is a raster layer mask
// Input: <none> Must have an open document
// Return: true if there is a vector mask
///////////////////////////////////////////////////////////////////////////////
function hasLayerMask() {
  var hasLayerMask = false;
  try {
    var ref = new ActionReference();
    var keyUserMaskEnabled = app.charIDToTypeID('UsrM');
    ref.putProperty(app.charIDToTypeID('Prpr'), keyUserMaskEnabled);
    ref.putEnumerated(app.charIDToTypeID('Lyr '), app.charIDToTypeID('Ordn'), app.charIDToTypeID('Trgt'));
    var desc = executeActionGet(ref);
    if (desc.hasKey(keyUserMaskEnabled)) {
      hasLayerMask = true;
    }
  } catch (e) {
    hasLayerMask = false;
  }
  return hasLayerMask;
}

///////////////////////////////////////////////////////////////////////////////
// Function: hasVectorMask
// Usage: see if there is a vector layer mask
// Input: <none> Must have an open document
// Return: true if there is a vector mask
///////////////////////////////////////////////////////////////////////////////
function hasVectorMask() {
  var hasVectorMask = false;
  try {
    var ref = new ActionReference();
    var keyVectorMaskEnabled = app.stringIDToTypeID('vectorMask');
    var keyKind = app.charIDToTypeID('Knd ');
    ref.putEnumerated(app.charIDToTypeID('Path'), app.charIDToTypeID('Ordn'), keyVectorMaskEnabled);
    var desc = executeActionGet(ref);
    if (desc.hasKey(keyKind)) {
      var kindValue = desc.getEnumerationValue(keyKind);
      if (kindValue == keyVectorMaskEnabled) {
        hasVectorMask = true;
      }
    }
  } catch (e) {
    hasVectorMask = false;
  }
  return hasVectorMask;
}

///////////////////////////////////////////////////////////////////////////////
// Function: hasFilterMask
// Usage: see if there is a Smart Filter mask
// Input: <none> Must have an open document
// Return: true if there is a Smart Filter mask
///////////////////////////////////////////////////////////////////////////////
function hasFilterMask() {
  var hasFilterMask = false;
  try {
    var ref = new ActionReference();
    var keyFilterMask = app.stringIDToTypeID("hasFilterMask");
    ref.putProperty(app.charIDToTypeID('Prpr'), keyFilterMask);
    ref.putEnumerated(app.charIDToTypeID('Lyr '), app.charIDToTypeID('Ordn'), app.charIDToTypeID('Trgt'));
    var desc = executeActionGet(ref);
    if (desc.hasKey(keyFilterMask) && desc.getBoolean(keyFilterMask)) {
      hasFilterMask = true;
    }
  } catch (e) {
    hasFilterMask = false;
  }
  return hasFilterMask;
}

///////////////////////////////////////////////////////////////////////////////
// Function: rasterizeLayer
// Usage: rasterize the current layer to pixels
// Input: <none> Must have an open document
// Return: <none>
///////////////////////////////////////////////////////////////////////////////
function rasterizeLayer() {
  try {
    var id1242 = stringIDToTypeID("rasterizeLayer");
    var desc245 = new ActionDescriptor();
    var id1243 = charIDToTypeID("null");
    var ref184 = new ActionReference();
    var id1244 = charIDToTypeID("Lyr ");
    var id1245 = charIDToTypeID("Ordn");
    var id1246 = charIDToTypeID("Trgt");
    ref184.putEnumerated(id1244, id1245, id1246);
    desc245.putReference(id1243, ref184);
    executeAction(id1242, desc245, DialogModes.NO);
  } catch (e) {
    // do nothing
  }
}
