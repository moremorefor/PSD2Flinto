// The MIT License (MIT)
//
// Copyright (c) 2015-2016 more_more_for
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

#target photoshop
app.bringToFront();

#include "js/json2.js"
#include "js/xorshift.js"
#include "js/uuid.js"
#include "js/polyfill.js"

preferences.rulerUnits = Units.PIXELS;

///////////////////////////////////////////////////////////////////////////////
// Settings
///////////////////////////////////////////////////////////////////////////////
var alwaysOverwrite = false;

///////////////////////////////////////////////////////////////////////////////
// Variables
///////////////////////////////////////////////////////////////////////////////
var d;
var documentName;
var metadata = {};
var metadata_doc = {};
var metadata_layers;
var historySnapshot;

var folder;
var exportFolder;
var docFolder;

var clippingGroups = [];
var _clippingGroup = [];

var ADJUSTMENT_LAYERS = [
  LayerKind.BRIGHTNESSCONTRAST,
  LayerKind.CHANNELMIXER,
  LayerKind.COLORBALANCE,
  LayerKind.CURVES,
  LayerKind.GRADIENTMAP,
  LayerKind.HUESATURATION,
  LayerKind.INVERSION,
  LayerKind.LEVELS,
  LayerKind.POSTERIZE,
  LayerKind.SELECTIVECOLOR,
  LayerKind.THRESHOLD
];

///////////////////////////////////////////////////////////////////////////////
// Main
///////////////////////////////////////////////////////////////////////////////
function run() {
  try {
    var documentPath = d.path;
  } catch (e) {
    alert("Document is not saved.\nPlease save this document.");
    return;
  }

  var dialog = new Dialog(d);
  dialog.show();
}

function main(scale, resolution, pixelDensity) {
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

  process_doc(scale);
  metadata["width"] = resolution["width"];
  metadata["height"] = resolution["height"];
  metadata["scale"] = pixelDensity;
  metadata["screens"] = [metadata_doc];

  json = JSON.stringify(metadata, null, "\t");
  writeToFile(json, exportFolder.fsName + "/metadata.json");

  var execFile = new File(exportFolder.fsName);
  execFile.execute();
}

function process_doc(scale) {
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
  if (scale != 1) {
    var w = parseInt(d.width, 10) * scale;
    var h = parseInt(d.height, 10) * scale;
    d.resizeImage(w, h, d.resolution, ResampleMethod.BICUBIC);
  }
  var layers = d.layers;
  preprocess_layers(layers);
  apply_preprocess();
  historySnapshot = createSnapshot();
  process_layers(layers, metadata_doc["layers"]);
  d.close(SaveOptions.DONOTSAVECHANGES);
  d = originDoc;
}

///////////////////////////////////////////////////////////////////////////////
// Preprocess
///////////////////////////////////////////////////////////////////////////////

function preprocess_layers(layers) {
  // From top
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    switch (layer.typename) {
      case "LayerSet":
        if (layer.visible) preprocess_layers(layer.layers);
        break;
      case "ArtLayer":
        preprocess_layer(layer);
        break;
      default:
        break;
    }
  }
}

function preprocess_layer(layer) {
  // clipping mask
  if (layer.grouped) {
    _clippingGroup.push(layer);
  } else if (_clippingGroup.length > 0) {
    _clippingGroup.push(layer);
    clippingGroups.push(_clippingGroup);
    _clippingGroup = [];
  }

  // adjustment layer
  if (!layer.grouped && ADJUSTMENT_LAYERS.indexOf(layer.kind) > -1) {
    layer.visible = false;
  }
}

function apply_preprocess() {
  for (var i = 0; i < clippingGroups.length; i++) {
    var clippingGroup = clippingGroups[i];
    mergeClippingMasks(clippingGroup);
  }
}

function mergeClippingMasks(layers) {
  // Some kind of layer does not be supported 'merge'.
  // So, it will convert to a normal layer.
  var bottomLayer = layers[layers.length - 1];
  var bottomVisibility = true;
  if (!bottomLayer.visible) {
    bottomVisibility = false;
    bottomLayer.visible = true;
  }
  activeDocument.activeLayer = bottomLayer;
  convertToSmartObject();
  rasterizeLayer();

  // From bottom
  for (var i = layers.length - 1; i >= 0; i--) {
    if (i != layers.length - 1) {
      var layer = layers[i];
      if (layer.visible) {
        layer.merge();
      } else {
        layer.remove();
      }
    }
  }

  if (!bottomVisibility) activeDocument.activeLayer.visible = false;
}

///////////////////////////////////////////////////////////////////////////////
// Process
///////////////////////////////////////////////////////////////////////////////

function process_layers(layers, metadata) {
  // From bottom
  for (var i = layers.length - 1; i >= 0; i--) {
    var layer = layers[i];
    if (!layer.visible) continue;

    switch (layer.typename) {
      case "LayerSet":
        process_layerSet(layer, metadata);
        break;
      case "ArtLayer":
        process_artLayer(layer, metadata);
        break;
      default:
        break;
    }
  }
}

function process_layerSet(layerSet, metadata) {
  d.activeLayer = layerSet;
  unlockLayer(layerSet);

  var recursiveFlag = true;
  if (hasVectorMask() || hasLayerMask() || hasLayerStyle(layerSet)) {
    recursiveFlag = false;
    flatten();
  }

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

  if (hasVectorMask() || hasLayerMask() || hasLayerStyle(layer) || isTextLayer(layer)) flatten();

  exportLayer(d.activeLayer, metadata);
}

function exportLayer(targetLayer, metadata) {
  hideAllOtherLayers();

  // metadata
  var data = generate_metadata(targetLayer);
  data["type"] = "image";
  metadata.push(data);

  // trim
  d.trim(TrimType.TRANSPARENT);

  // export
  var webFile = new File(docFolder + "/" + data["id"] + ".png");
  var webOpt = new ExportOptionsSaveForWeb();
  webOpt.format = SaveDocumentType.PNG;
  webOpt.PNG8 = false;
  d.exportDocument(webFile, ExportType.SAVEFORWEB, webOpt);

  revertHistorySate(historySnapshot);
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
function isPropEnabled(obj, key) {
  if (key in obj) {
    if (obj[key].enabled) return true;
  }
  return false;
}

function flatten() {
  convertToSmartObject();
  rasterizeLayer();
}

function hasLayerStyle(layer) {
  var styles = getLayerStylesObject(layer);
  if (isPropEnabled(styles, "dropShadow") ||
    isPropEnabled(styles, "innerShadow") ||
    isPropEnabled(styles, "outerGlow") ||
    isPropEnabled(styles, "innerGlow") ||
    isPropEnabled(styles, "bevelEmboss") ||
    isPropEnabled(styles, "chromeFX") ||
    isPropEnabled(styles, "solidFill") ||
    isPropEnabled(styles, "gradientFill") ||
    isPropEnabled(styles, "patternFill") ||
    isPropEnabled(styles, "frameFX")) {
    return true;
  }
  return false;
}

function isTextLayer(layer) {
  if (layer.kind == LayerKind.TEXT) return true;
  return false;
}

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

function hideAllOtherLayers() {
  var idShw = charIDToTypeID( "Shw " );
      var desc13 = new ActionDescriptor();
      var idnull = charIDToTypeID( "null" );
          var list9 = new ActionList();
              var ref11 = new ActionReference();
              var idLyr = charIDToTypeID( "Lyr " );
              var idOrdn = charIDToTypeID( "Ordn" );
              var idTrgt = charIDToTypeID( "Trgt" );
              ref11.putEnumerated( idLyr, idOrdn, idTrgt );
          list9.putReference( ref11 );
      desc13.putList( idnull, list9 );
      var idTglO = charIDToTypeID( "TglO" );
      desc13.putBoolean( idTglO, true );
  executeAction( idShw, desc13, DialogModes.NO );
}

function convertToSmartObject() {
  var idnewPlacedLayer = stringIDToTypeID("newPlacedLayer");
  executeAction(idnewPlacedLayer, undefined, DialogModes.NO);
}

function createSnapshot() {
  var idMk = charIDToTypeID( "Mk  " );
      var desc14 = new ActionDescriptor();
      var idnull = charIDToTypeID( "null" );
          var ref10 = new ActionReference();
          var idSnpS = charIDToTypeID( "SnpS" );
          ref10.putClass( idSnpS );
      desc14.putReference( idnull, ref10 );
      var idFrom = charIDToTypeID( "From" );
          var ref11 = new ActionReference();
          var idHstS = charIDToTypeID( "HstS" );
          var idCrnH = charIDToTypeID( "CrnH" );
          ref11.putProperty( idHstS, idCrnH );
      desc14.putReference( idFrom, ref11 );
  executeAction( idMk, desc14, DialogModes.NO );

  var historyStates = d.historyStates;
  for (var i = historyStates.length-1; i >= 0; i--) {
    if (historyStates[i].snapshot) {
      return historyStates[i];
    }
  }
  return false;
}

function revertHistorySate(historyState) {
  d.activeHistoryState = historyState;
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

///////////////////////////////////////////////////////////////////////////////
// GUI
///////////////////////////////////////////////////////////////////////////////
var Dialog = function(doc) {
  this.scaleList = [
    "50%",
    "100%",
    "150%",
    "200%",
    "300%"
  ];

  this.scaleFactorIndexs = [3, 4, 3, 3, 3, 3, 1];

  this.deviceList = [
    "iPhone 6",
    "iPhone 6 Plus",
    "iPhone (4 inch)",
    "iPad",
    "Apple Watch (42mm)",
    "Apple Watch (38mm)",
    "Custom"
  ];
  this.resolutions = [
    {width: 750,  height: 1334}, // iPhone 6
    {width: 1242, height: 2208}, // iPhone 6 Plus
    {width: 640,  height: 1136}, // iPhone 4 inch
    {width: 2048, height: 1536}, // iPad Retina
    {width: 312,  height: 390}, // Apple Watch 42mm
    {width: 272,  height: 460} // Apple Watch 38mm
  ];

  this.deviceSelectedIndex = 6;
  var suggestedScaleFactor = 1.0;

  this.isLandscape = false;

  var docW = parseInt(doc.width, 10);
  var docH = parseInt(doc.height, 10);
  this.initialSize = {
    width: docW,
    height: docH
  };

  this.dialog = new Window('dialog', 'PSD2Flinto', [0, 0, 420, 310]);
  this.setupWindow();

  for (var index = 0; index < this.resolutions.length; index++) {
    var resolution = this.resolutions[index];
    if (docW == resolution.width || docW * 2 == resolution.width || docW * 3 == resolution.width) {
      this.deviceSelectedIndex = index;
      suggestedScaleFactor = resolution.width / docW;
      this.initialSize = {
        width: (resolution.width / suggestedScaleFactor),
        height: (resolution.height / suggestedScaleFactor)
      };
      break;
    }
    if (docW == resolution.height || docW * 2 == resolution.height || docW * 3 == resolution.height) {
      this.isLandscape = true;
      this.deviceSelectedIndex = index;
      suggestedScaleFactor = resolution.height / docW;
      this.initialSize = {
        width: (resolution.width / suggestedScaleFactor),
        height: (resolution.height / suggestedScaleFactor)
      };
      break;
    }
  }

  this.dialog.deviceList.selection = this.deviceSelectedIndex;

  var scaleFactorIndex = 1;
  if (suggestedScaleFactor != 1) {
    scaleFactorIndex = this.scaleFactorIndexs[this.deviceSelectedIndex];
  }
  this.dialog.scaleList.selection = scaleFactorIndex;
  this.scaleFactor = parseFloat(this.dialog.scaleList.selection.toString().replace(/[^0-9]/g, "")) / 100;

  this.updateSizeTextField();
};

Dialog.prototype.setupWindow = function() {
  var self = this;
  var dlg = this.dialog;

  // Title
  dlg.labelHeadline = dlg.add('statictext', [102, 18, 323, 43], 'Export as Flinto Document', {
    multiline: true
  });
  dlg.labelHeadline.graphics.font = ScriptUI.newFont("Helvetica", ScriptUI.FontStyle.BOLD, 16);

  // ScaleList
  dlg.labelScale = dlg.add('statictext', [35, 77, 131, 102], ' Scale', {
    multiline: true
  });
  dlg.labelScale.graphics.font = ScriptUI.newFont("Helvetica", ScriptUI.FontStyle.BOLD, 14);
  dlg.labelScale.justify = "right";
  dlg.scaleList = dlg.add('dropdownlist', [140, 71, 315, 96], this.scaleList);
  dlg.scaleList.selection = 1;

  dlg.scaleList.onChange = function() {
    self.updateSizeTextField();
  };

  // DeviceList
  dlg.labelDevice = dlg.add('statictext', [35, 125, 131, 150], 'Device Size', {
    multiline: true
  });
  dlg.labelDevice.graphics.font = ScriptUI.newFont("Helvetica", ScriptUI.FontStyle.BOLD, 14);
  dlg.labelDevice.justify = "right";
  dlg.deviceList = dlg.add('dropdownlist', [140, 119, 315, 144], this.deviceList);
  dlg.deviceList.selection = 0;

  dlg.deviceList.onChange = function() {
    var idx = dlg.deviceList.selection.index;
    if (idx < 6) {
      var r = self.resolutions[idx];
      var s = parseFloat(dlg.scaleList.selection.toString().replace(/[^0-9]/g, "")) / 100;
      self.initialSize.width = r.width / s;
      self.initialSize.height = r.height / s;
      self.updateSizeTextField();
    }
  };

  // Size
  dlg.deviceWidth = dlg.add('edittext', [140, 170, 233, 192]);
  dlg.deviceWidth.text = this.resolutions[0]["width"];
  dlg.deviceWidth.justify = "center";

  dlg.deviceHeight = dlg.add('edittext', [248, 170, 340, 192]);
  dlg.deviceHeight.text = this.resolutions[0]["height"];
  dlg.deviceHeight.justify = "center";

  dlg.labelDeviceWidth = dlg.add('statictext', [140, 202, 233, 228], 'Width', {
    multiline: true
  });
  dlg.labelDeviceWidth.graphics.font = ScriptUI.newFont("Helvetica", ScriptUI.FontStyle.REGULAR, 14);
  dlg.labelDeviceWidth.justify = "center";

  dlg.labelDeviceHeight = dlg.add('statictext', [248, 202, 340, 228], 'Height', {
    multiline: true
  });
  dlg.labelDeviceHeight.graphics.font = ScriptUI.newFont("Helvetica", ScriptUI.FontStyle.REGULAR, 14);
  dlg.labelDeviceHeight.justify = "center";

  // Button
  dlg.btnCancel = dlg.add('button', [140, 252, 249, 279], 'cancel');
  dlg.btnSave = dlg.add('button', [260, 252, 369, 279], 'OK');

  dlg.btnSave.onClick = function() {
    var _scale = dlg.scaleList.selection;
    var scale = parseFloat(_scale.toString().replace(/[^0-9]/g, "")) / 100;

    var pixelDensity = 1.0;
    var deviceType = dlg.deviceList.selection;
    if (deviceType != 6) {
      pixelDensity = deviceType == 1 ? 3.0 : 2.0;
    }

    var _width = parseFloat(dlg.deviceWidth.text);
    if (!_width || _width <= 0) {
      alert("Please enter a valid width.");
      return;
    }

    var _height = parseFloat(dlg.deviceHeight.text);
    if (!_height || _height <= 0) {
      alert("Please enter a valid height.");
      return;
    }

    var resolution = {
      width: _width,
      height: _height
    };

    dlg.close();

    main(scale, resolution, pixelDensity);
  };

  dlg.center();
};

Dialog.prototype.updateSizeTextField = function() {
  var dlg = this.dialog;
  var index = dlg.deviceList.selection.index;

  var r = this.initialSize;
  var w = r.width;
  var h = r.height;

  if (this.isLandscape) {
    var tmp = w;
    w = h;
    h = tmp;
  }

  var s = parseFloat(dlg.scaleList.selection.toString().replace(/[^0-9]/g, "")) / 100;
  dlg.deviceWidth.text = w * s;
  dlg.deviceHeight.text = h * s;
};

Dialog.prototype.show = function() {
  this.dialog.show();
};


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


///////////////////////////////////////////////////////////////////////////////
// ExportLayerStyle.jsx
// https://github.com/tomkrcha/LayerMiner
///////////////////////////////////////////////////////////////////////////////
function getLayerStylesObject(layer) {
  var preLayer = app.activeDocument.activeLayer;
  app.activeDocument.activeLayer = layer;
  var obj = getLayerStyles();
  if (obj == null) {
    // alert("No style to assigned to the selected layer.");
    obj = {};
  }

  app.activeDocument.activeLayer = preLayer;

  return obj;
}

// Available LayerStyle properties: frameFX, solidFill, gradientFill, chromeFX, bevelEmboss, innerGlow, outerGlow, innerShadow, dropShadow.opacity/distance
function getLayerStyles() {
  var ref = new ActionReference();
  ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  var layerDesc = executeActionGet(ref);
  if (layerDesc.hasKey(stringIDToTypeID('layerEffects'))) {
    stylesDesc = layerDesc.getObjectValue(stringIDToTypeID('layerEffects'));
    var obj = actionDescriptorToObject(stylesDesc);
    return obj;
  }
};

function actionDescriptorToObject(desc) {
  var obj = {};
  var len = desc.count;
  for (var i = 0; i < len; i++) {
    var key = desc.getKey(i);
    obj[typeIDToStringID(key)] = getValueByType(desc, key);
  }
  return obj;
}
// Get a value from an ActionDescriptor by a type defined by a key
// ALIASTYPE BOOLEANTYPE CLASSTYPE DOUBLETYPE ENUMERATEDTYPE INTEGERTYPE LARGEINTEGERTYPE LISTTYPE OBJECTTYPE RAWTYPE REFERENCETYPE STRINGTYPE UNITDOUBLE
function getValueByType(desc, key) {
  var type = desc.getType(key);
  var value = null;
  switch (type) {
    case DescValueType.ALIASTYPE:
      value = "alias";
      break;
    case DescValueType.BOOLEANTYPE:
      value = desc.getBoolean(key);
      break;
    case DescValueType.CLASSTYPE:
      value = desc.getClass(key);
      break;
    case DescValueType.OBJECTTYPE:
      value = actionDescriptorToObject(desc.getObjectValue(key)); //+" - "+desc.getObjectType(key);
      break;
    case DescValueType.ENUMERATEDTYPE:
      value = typeIDToStringID(desc.getEnumerationValue(key));
      break;
    case DescValueType.DOUBLETYPE:
      value = desc.getDouble(key);
      break;
    case DescValueType.INTEGERTYPE:
      value = desc.getInteger(key);
      break;
    case DescValueType.LARGEINTEGERTYPE:
      value = desc.getLargeInteger(key);
      break;
    case DescValueType.LISTTYPE:
      value = desc.getList(key);
      break;
    case DescValueType.RAWTYPE:
      // not implemented
      break;
    case DescValueType.REFERENCETYPE:
      value = desc.getReference(key);
      break;
    case DescValueType.STRINGTYPE:
      value = desc.getString(key);
      break;
    case DescValueType.UNITDOUBLE:
      value = desc.getUnitDoubleValue(key);
      break;
  }
  return value;
}

///////////////////////////////////////////////////////////////////////////////
// Start
///////////////////////////////////////////////////////////////////////////////
if (app.documents.length === 0) {
  alert("Document not found.");
} else {
  d = activeDocument;
  run();
}
