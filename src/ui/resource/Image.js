/**
 * @license
 * This file is part of the Game Closure SDK.
 *
 * The Game Closure SDK is free software: you can redistribute it and/or modify
 * it under the terms of the Mozilla Public License v. 2.0 as published by Mozilla.

 * The Game Closure SDK is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * Mozilla Public License v. 2.0 for more details.

 * You should have received a copy of the Mozilla Public License v. 2.0
 * along with the Game Closure SDK.  If not, see <http://mozilla.org/MPL/2.0/>.
 */

/**
 * @class ui.resource.Image;
 * Model an Image for rendering. Supports taking a subset of images, to support
 * extracting from compacted sprite sheets. Also supports applying filters to
 * an image, usually by the View class.
 *
 * @doc http://doc.gameclosure.com/api/ui-imageview.html#class-ui.resource.image
 * @docsrc https://github.com/gameclosure/doc/blob/master/api/ui/imageview.md
 */

import device;
import lib.PubSub;
import event.Callback as Callback;
import ui.resource.loader as resourceLoader;

/**
 * Callback when images are loaded. This has a failsafe that runs up to a certain
 * threshold asynchronously, attempting to read the image size, before dying.
 */

var ImageCache = {};

// `imageOnLoad` is called when a DOM image object fires a `load` or `error`
// event.  Fire the internal `cb` with the error status.
function imageOnLoad(success, evt, failCount) {
	if (success && !this.width) {
		// Some browsers fire the load event before the image width is
		// available.  Wait up to 3 frames for the width.  Note that an image
		// with zero-width will be considered an error.
		if (failCount <= 3) {
			setTimeout(bind(this, imageOnLoad, success, evt, (failCount || 0) + 1), 0);
		} else {
			this.__cb.fire(false);
		}
	} else {
		this.__cb.fire(!success);
	}
}

/**
 * This class models the region of a larger image that this "Image" references.
 */

var ImageMap = !CONFIG.disableNativeViews
	&& NATIVE.timestep && NATIVE.timestep.ImageMap;
if (!ImageMap) {
	ImageMap = Class(function () {
		this.init = function (parentImage, x, y, width, height, marginTop, marginRight, marginBottom, marginLeft, url) {
			this.url = url;
			this.x = x;
			this.y = y;
			this.width = width;
			this.height = height;
			this.marginTop = marginTop;
			this.marginRight = marginRight;
			this.marginBottom = marginBottom;
			this.marginLeft = marginLeft;
		};
	});
}

exports = Class(lib.PubSub, function () {

	var isNative = GLOBAL.NATIVE && !device.isNativeSimulator;
	var Canvas = device.get('Canvas');

	// helper canvases for filters and image data, initialized when/if needed
	var _filterCanvas = null;
	var _filterCtx = null;
	var _imgDataCanvas = null;
	var _imgDataCtx = null;

	this.init = function (opts) {
		if (!opts) {
			opts = {};
		}

		this._cb = new Callback();
		this._map = new ImageMap(this, 0, 0, -1, -1, 0, 0, 0, 0, opts.url || '');
		this._originalURL = opts.url || '';
		this._scale = opts.scale || 1;
		this._isError = false;

		resourceLoader._updateImageMap(this._map, opts.url, opts.sourceX, opts.sourceY, opts.sourceW, opts.sourceH);

		// srcImage can be null, then setSrcImg will create one
		// (use the map's URL in case it was updated to a spritesheet)
		this._setSrcImg(opts.srcImage, this._map.url, opts.forceReload);
	};

	this._setSrcImg = function (img, url, forceReload) {
		this._cb.reset();

		// if we haven't found an image, look in the image cache
		if (!img && url && !forceReload && ImageCache[url]) {
			img = ImageCache[url];
		}

		// look up the base64 cache -- if it's been preloaded, we'll get back an image that's already loaded
		// if it has not been preloaded, we'll get back raw base64 in the b64 variable
		if (!img && !forceReload && Image.get) {
			var b64 = Image.get(url);
			if (typeof b64 === 'object') {
				img = b64;
			} else if (b64) {
				url = b64;
			}
		}

		if (forceReload) {
			// clear native texture in an image object
			if (img && img.destroy) {
				img.destroy();
			}

			// clear native textures by URL
			if (url && NATIVE.gl && NATIVE.gl.deleteTexture) {
				NATIVE.gl.deleteTexture(url);
			}
		}

		// create an image if we don't have one
		if (!img) {
			img = new Image();
		}

		this._srcImg = img;

		if (img instanceof HTMLCanvasElement) {
			this._onLoad(false, img); // no error
		} else {
			// if it's already loaded, we call _onLoad immediately. Note that
			// we don't use `.complete` here intentionally since web browsers
			// set `.complete = true` before firing on the load/error
			// callbacks, so we can't actually detect whether there's an error
			// in some cases.
			if (!img.__cb) {
				img.__cb = new Callback();
				img.addEventListener('load', bind(img, imageOnLoad, true), false);
				img.addEventListener('error', bind(img, imageOnLoad, false), false);

				if (url) {
					ImageCache[url] = img;
				}

				if (!img.src && url) {
					img.src = this._map.url = url;
				}
			}

			img.__cb.run(this, function (err) {
				this._onLoad(err, img);
			});
		}
	};

	this.getSource = this.getSrcImg = function () {
		return this._srcImg;
	};

	this.setSource = this.setSrcImg = function (srcImg) {
		this._setSrcImg(srcImg);
	};

	this.reload = function (cb) {
		var srcImg = this._srcImg;
		if (srcImg) {
			// if passed a lib.Callback, chain it
			if (cb && cb.chain) {
				cb = cb.chain();
			}

			// GC native has a reload method to force reload
			if (srcImg.reload) {
				var onReload = bind(this, function () {
					srcImg.removeEventListener('reload', onReload, false);
					cb && cb();
				});
				srcImg.addEventListener('reload', onReload, false);
				srcImg.reload();
			} else if (cb) {
				if (this._cb.fired()) {
					// always wait a frame before calling the callback
					setTimeout(cb, 0);
				} else {
					this._cb.run(cb);
				}
			}
		}
	};

	this.getURL = function () {
		return this._map.url;
	};

	this.getOriginalURL = function () {
		return this._originalURL;
	};

	this.getSourceX = function () {
		return this._map.x;
	};

	this.getSourceY = function () {
		return this._map.y;
	};

	this.getSourceWidth = this.getSourceW = function () {
		return this._map.width;
	};

	this.getSourceHeight = this.getSourceH = function () {
		return this._map.height;
	};

	this.getOrigWidth = this.getOrigW = function () {
		return this._srcImg.width;
	};

	this.getOrigHeight = this.getOrigH = function () {
		return this._srcImg.height;
	};

	this.setSourceX = function (x) {
		this._map.x = x;
	};

	this.setSourceY = function (y) {
		this._map.y = y;
	};

	this.setSourceWidth = this.setSourceW = function (w) {
		this._map.width = w;
	};

	this.setSourceHeight = this.setSourceH = function (h) {
		this._map.height = h;
	};

	this.setMarginTop = function (n) {
		this._map.marginTop = n;
	};

	this.setMarginRight = function (n) {
		this._map.marginRight = n;
	};

	this.setMarginBottom = function (n) {
		this._map.marginBottom = n;
	};

	this.setMarginLeft = function (n) {
		this._map.marginLeft = n;
	};

	this.setURL = function (url, forceReload) {
		resourceLoader._updateImageMap(this._map, url);
		this._setSrcImg(null, this._map.url, forceReload);
	};

	this.getWidth = function () {
		var map = this._map;
		return (map.width == -1 ? 0
			: map.width + map.marginLeft + map.marginRight) / map.scale;
	};

	this.getHeight = function () {
		var map = this._map;
		return (map.height === -1 ? 0
			: map.height + map.marginTop + map.marginBottom) / map.scale;
	};

	this.getMap = this.getBounds = function () {
		return this._map;
	};

	this.setMap = this.setBounds = function (x, y, w, h, marginTop, marginRight, marginBottom, marginLeft) {
		var map = this._map;
		map.x = x;
		map.y = y;
		map.width = w;
		map.height = h;
		map.marginTop = marginTop || 0;
		map.marginRight = marginRight || 0;
		map.marginBottom = marginBottom || 0;
		map.marginLeft = marginLeft || 0;
		this.emit('changeBounds');
	};

	// register a callback for onload
	this.doOnLoad = function () {
		this._cb.forward(arguments);
		return this;
	};

	// internal onload handler for actual Image object
	// img is the internal image that triggered the _onLoad callback
	this._onLoad = function (err, img) {
		var map = this._map;
		var srcImg = this._srcImg;
		// if our source image has changed we should ignore this onload callback
		// this can happen if _setSrcImg is called multiple times with different urls/images
		if (img && img !== srcImg) {
			return;
		}

		if (err) {
			// TODO: something better?
			logger.error('Image failed to load:', map.url);
			this._isError = true;
			this._cb.fire({ NoImage: true });
			return;
		}

		this._isError = false;

		if (srcImg.width === 0) {
			logger.warn('Image has no width', this._url);
		}

		if (this._scale !== 1 && (map.width !== -1 || map.height !== -1)) {
			// requested scale & provided a width or height
			if (map.width === -1) {
				// by the above check, this._sourceH should not be -1
				map.width = srcImg.width * map.height / srcImg.height;
			}

			if (map.height === -1) {
				// this._sourceW was initialized above
				map.height = srcImg.height * map.width / srcImg.width;
			}

			// TODO: sourceImage might be shared so we can't actually modify width/height. This is a bug.
			srcImg.width = map.width;
			srcImg.height = map.height;
		} else {
			if (map.width === -1) {
				map.width = srcImg.width;
			}
			if (map.height === -1) {
				map.height = srcImg.height;
			}
		}

		map.url = srcImg.src;
		this._cb.fire(null, this);
	};

	this.isError = function () {
		return this._isError;
	};

	this.isLoaded = this.isReady = function () {
		return !this._isError && this._cb.fired();
	};

	this._renderFilter = function (ctx, srcX, srcY, srcW, srcH, color, op) {
		_filterCanvas.width = srcW;
		_filterCanvas.height = srcH;
		// render the base image
		_filterCtx.globalCompositeOperation = 'source-over';
		this.render(_filterCtx, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
		// render the filter color
		_filterCtx.globalCompositeOperation = op;
		_filterCtx.fillStyle = "rgba(" + color.r  + "," + color.g + "," + color.b + "," + color.a + ")";
		_filterCtx.fillRect(0, 0, srcW, srcH);
		// use our base image to cut out the image shape from the rect
		_filterCtx.globalCompositeOperation = 'destination-in';
		this.render(_filterCtx, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
		return _filterCanvas;
	};

	this._renderMultiply = function (ctx, srcX, srcY, srcW, srcH, color) {
		// multiply rgb channels
		var imgData = this.getImageData(srcX, srcY, srcW, srcH);
		var data = imgData.data;
		// simplified multiply math outside of the massive for loop
		var a = color.a;
		var mr = 1 + a * ((color.r / 255) - 1);
		var mg = 1 + a * ((color.g / 255) - 1);
		var mb = 1 + a * ((color.b / 255) - 1);
		for (var i = 0, len = data.length; i < len; i += 4) {
			data[i] *= mr;
			data[i + 1] *= mg;
			data[i + 2] *= mb;
		}
		// put the updated rgb data into our filter canvas
		_filterCanvas.width = imgData.width;
		_filterCanvas.height = imgData.height;
		_filterCtx.putImageData(imgData, 0, 0);
		return _filterCanvas;
	};

	this._renderMask = function (ctx, srcX, srcY, srcW, srcH, mask, op) {
		_filterCanvas.width = srcW;
		_filterCanvas.height = srcH;
		// render the mask image
		var srcMaskX = mask.getSourceX();
		var srcMaskY = mask.getSourceY();
		var srcMaskW = mask.getSourceW();
		var srcMaskH = mask.getSourceH();
		_filterCtx.globalCompositeOperation = 'source-over';
		mask.render(_filterCtx, srcMaskX, srcMaskY, srcMaskW, srcMaskH, 0, 0, srcW, srcH);
		// render the base image
		_filterCtx.globalCompositeOperation = op;
		this.render(_filterCtx, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
		return _filterCanvas;
	};

	this._applyFilters = function (ctx, srcX, srcY, srcW, srcH) {
		// initialize a shared filterCanvas when/if needed
		if (_filterCanvas === null) {
			_filterCanvas = new Canvas();
			_filterCtx = _filterCanvas.getContext('2d');
		}

		var resultImg = this._srcImg;
		var filters = ctx.filters;
		var linearAdd = filters.LinearAdd;
		var tint = filters.Tint;
		var mult = filters.Multiply;
		var negMask = filters.NegativeMask;
		var posMask = filters.PositiveMask;
		// only one filter can actually be applied at a time
		if (linearAdd) {
			resultImg = this._renderFilter(ctx, srcX, srcY, srcW, srcH, linearAdd.get(), 'lighter');
		} else if (tint) {
			resultImg = this._renderFilter(ctx, srcX, srcY, srcW, srcH, tint.get(), 'source-over');
		} else if (mult) {
			resultImg = this._renderMultiply(ctx, srcX, srcY, srcW, srcH, mult.get());
		} else if (negMask) {
			resultImg = this._renderMask(ctx, srcX, srcY, srcW, srcH, negMask.getMask(), 'source-in');
		} else if (posMask) {
			resultImg = this._renderMask(ctx, srcX, srcY, srcW, srcH, posMask.getMask(), 'source-out');
		}
		return resultImg;
	};

	this.render = function (ctx) {
		if (!this._cb.fired()) {
			return;
		}

		var map = this._map;
		var srcImg = this._srcImg;
		var args1 = arguments[1];
		var args2 = arguments[2];
		var args3 = arguments[3];
		var args4 = arguments[4];
		var args5 = arguments[5];
		var args6 = arguments[6];
		var args7 = arguments[7];
		var args8 = arguments[8];
		var args9 = arguments[9];
		var srcX = map.x;
		var srcY = map.y;
		var srcW = map.width;
		var srcH = map.height;
		var destX = args5 !== void 0 ? args5 : args1 || 0;
		var destY = args6 !== void 0 ? args6 : args2 || 0;
		var destW = args7 !== void 0 ? args7 : args3 || 0;
		var destH = args8 !== void 0 ? args8 : args4 || 0;

		if (arguments.length < 9) {
			var scaleX = destW / (map.marginLeft + map.width + map.marginRight);
			var scaleY = destH / (map.marginTop + map.height + map.marginBottom);
			destX += scaleX * map.marginLeft;
			destY += scaleY * map.marginTop;
			destW = scaleX * map.width;
			destH = scaleY * map.height;
		} else {
			srcX = args1;
			srcY = args2;
			srcW = args3;
			srcH = args4;
		}

		if (!isNative && ctx.filters) {
			srcImg = this._applyFilters(ctx, srcX, srcY, srcW, srcH);
			if (srcImg !== this._srcImg) {
				srcX = 0;
				srcY = 0;
			}
		}

		this._renderImage(ctx, srcImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
	};

	this._renderImage = function(ctx, srcImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH) {
		try {
			ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
		} catch(e) {}
	};

	this.getImageData = function (x, y, width, height) {
		// initialize a shared imgDataCanvas when/if needed
		if (_imgDataCanvas === null) {
			_imgDataCanvas = new Canvas();
			_imgDataCtx = _imgDataCanvas.getContext('2d');
		}

		var map = this._map;
		if (!GLOBAL.document || !document.createElement) { throw 'Not supported'; }
		if (!map.width || !map.height) { throw 'Not loaded'; }

		x = x || 0;
		y = y || 0;
		width = width || map.width;
		height = height || map.height;
		_imgDataCanvas.width = width;
		_imgDataCanvas.height = height;

		_imgDataCtx.clear();
		this.render(_imgDataCtx, x, y, width, height, 0, 0, width, height);
		return _imgDataCtx.getImageData(0, 0, width, height);
	};

	this.setImageData = function (data) {};

	this.destroy = function () {
		this._srcImg.destroy && this._srcImg.destroy();
	};

});

exports.__clearCache__ = function () {
	ImageCache = {};
};
