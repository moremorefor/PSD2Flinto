# PSD2Flinto

PSD2Flinto is Photoshop script to export the document as [Flinto for Mac](https://www.flinto.com/mac) document.

_NOTE: This script supports Flinto for Mac version 1.3.x_

![PSD2Flinto](https://cloud.githubusercontent.com/assets/966109/12460324/8eb7ec52-bff6-11e5-872d-5d134d7806d4.png)

![PSD2Flinto](https://cloud.githubusercontent.com/assets/966109/12460340/9ae7aa8a-bff6-11e5-92aa-f07f590e1bcb.png)

## Installing script
To install a script in the Scripts menu, place it in the Scripts folder.
- `Mac: /Applications/Photoshop VERSION/Presets/Scripts`

For more information, please visit [here](http://www.adobe.com/devnet/photoshop/scripting.html).

---

#### Notes about required option
_**※ By default, this step is not necessary**_

Please open `History options...` panel, and select this option.

- `Automatically Create First Snapshot`

Then, reopen the psd file.

## 3rd party libraries
- [json2.js](https://github.com/douglascrockford/JSON-js)
- [node-uuid](https://github.com/broofa/node-uuid)

## Tested environment
- Mac OSX Yosemite
- Photoshop CC, CC2014, CC2015

## To-do
- [ ] Performance improvement
- [x] Export settings panel
- [x] Support for clipping mask
- [x] Support for layer style
- [x] Support for layer comp
- [ ] Support for artboard
- [ ] Support for image rotation
- [ ] Support for layer lock
- [ ] Change to the CEP plugin

## License
PSD2Flinto is available under the MIT license. See the LICENSE file for more info.
