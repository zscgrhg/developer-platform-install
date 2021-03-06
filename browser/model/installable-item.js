'use strict';

import Hash from './helpers/hash';
import Logger from '../services/logger';
import path from 'path';
import fs from 'fs-extra';
import Downloader from './helpers/downloader';
let remote = require('electron').remote;

let ipcRenderer = require('electron').ipcRenderer;

class InstallableItem {
  constructor(keyName, downloadUrl, fileName, targetFolderName, installerDataSvc, authRequired) {
    this.keyName = keyName;
    let requirement = installerDataSvc.getRequirementByName(keyName);
    this.productName = requirement.name;
    this.productVersion = requirement.version;
    this.productDesc = requirement.description;
    this.targetFolderName = targetFolderName;
    this.installerDataSvc = installerDataSvc;
    this.existingInstall = false;
    this.existingInstallLocation = '';
    this.existingVersion = '';
    this.useDownload = true;
    this.downloaded = false;
    this.installed = false;

    this.selected = true;
    this.version = requirement.version;

    this.detected = false;
    this.detectedVersion = 'unknown';
    this.detectedInstallLocation = '';

    if (downloadUrl == null || downloadUrl == '') {
      throw(new Error(`No download URL set for ${keyName} Installer`));
    }

    this.downloadUrl = downloadUrl;

    this.bundleFolder = remote && remote.getCurrentWindow().bundleTempFolder ? remote.getCurrentWindow().bundleTempFolder : path.normalize(path.join(__dirname, '../../../..'));
    this.bundledFile = path.join(this.bundleFolder, fileName);

    this.isCollapsed = true;
    this.option = new Set();
    this.selectedOption = 'install';

    this.downloader = null;
    this.downloadFolder = this.installerDataSvc.tempDir();
    this.downloadedFile = path.join(this.installerDataSvc.tempDir(), fileName);
    this.installAfter = undefined;
    this.ipcRenderer = ipcRenderer;
    this.authRequired = authRequired;
  }

  getProductName() {
    return this.productName;
  }

  getProductVersion() {
    if(this.isDetected()) {
      return this.option[this.selectedOption].version;
    }
    return this.productVersion;
  }

  getProductDesc() {
    return this.productDesc;
  }

  getDownloadUrl() {
    return this.downloadUrl;
  }

  isDownloaded() {
    return this.downloaded;
  }

  isInstalled() {
    return this.installed;
  }

  hasExistingInstall() {
    return this.existingInstall;
  }

  isDownloadRequired() {
    return this.useDownload;
  }

  setDownloadComplete() {
    this.downloaded = true;
  }

  setInstallComplete() {
    this.installed = true;
  }

  detectExistingInstall () {
    return Promise.resolve();
  }

  checkForExistingInstall() {
    // To be overridden
  }

  validateVersion() {
    //to be overriden
  }

  downloadInstaller(progress, success, failure) {
    this.downloader = new Downloader(progress, success, failure);
    if(fs.existsSync(this.bundledFile)) {
      this.downloadedFile = this.bundledFile;
      this.downloader.closeHandler();
    } else {
      this.checkAndDownload(
        this.downloadedFile,
        this.downloadUrl,
        this.sha256,
        this.authRequired ? this.installerDataSvc.getUsername() : undefined,
        this.authRequired ? this.installerDataSvc.getPassword() : undefined,
        progress
      );
    }
  }

  checkAndDownload(downloadedFile, url, sha, user, pass, progress) {
    if(fs.existsSync(downloadedFile)) {
      let h = new Hash();

      if (progress.current === 0 && progress.status !== 'Downloading') {
        progress.setStatus('Verifying Existing Download');
      }

      h.SHA256(downloadedFile, (dlSha) => {
        if(sha === dlSha) {
          Logger.info(`Using previously downloaded file='${downloadedFile}' sha256='${dlSha}'`);
          this.downloader.successHandler(downloadedFile);
        } else {
          this.startDownload(downloadedFile, url, sha, user, pass, progress);
        }
      });
    } else {
      this.startDownload(downloadedFile, url, sha, user, pass, progress);
    }
  }

  startDownload(downloadedFile, url, sha, user, pass, progress) {
    progress.setStatus('Downloading');
    let ws = fs.createWriteStream(downloadedFile);
    this.downloader.setWriteStream(ws);
    if(user === undefined && pass === undefined ) {
      this.downloader.download(url, downloadedFile, sha);
    } else {
      this.downloader.downloadAuth(url, user, pass, downloadedFile, sha);
    }
  }

  install(progress, success, failure) {
    if( !this.getInstallAfter() || this.getInstallAfter().isInstalled() ) {
      this.installAfterRequirements(progress, success, failure);
    } else {
      let name = this.getInstallAfter().productName;
      progress.setStatus(`Waiting for ${name} to finish installation`);
      this.ipcRenderer.on('installComplete', (event, arg) => {
        if (!this.isInstalled() && arg === this.getInstallAfter().keyName) {
          this.installAfterRequirements(progress, success, failure);
        }
      });
    }
  }

  changeIsCollapsed() {
    this.isCollapsed = !this.isCollapsed;
  }

  hasOption(name) {
    return this.option[name]!=undefined;
  }

  addOption(name, version, location, valid) {
    this.option[name] = {
      'version'  : version,
      'location' : location,
      'valid'    : valid,
      'error'    : '',
      'warning'  : ''
    };
  }

  setOptionLocation(name, location) {
    if(this.option[name]) {
      this.option[name].location = location;
    }
  }

  // Override parent "true" and check if we have something setup
  isConfigured() {
    let t =
      this.selectedOption == 'install'
        || this.selectedOption == 'detected' && this.hasOption('detected') && this.option['detected'].valid
        || this.selectedOption == 'detected' && !this.hasOption('detected');
    return t;
  }

  isDetected() {
    return this.selectedOption == 'detected' && this.hasOption('detected');
  }

  isInvalidVersionDetected() {
    return this.hasOption('detected') && !this.option['detected'].valid;
  }

  isNotDetected() {
    return !this.hasOption('detected');
  }

  isSkipped() {
    return this.selectedOption == 'detected';
  }


  getLocation() {
    return this.isDetected()
      ? this.option.detected.location
      : this.option.install.location;
  }

  restartDownload() {
    this.downloader.restartDownload();
  }

  getInstallAfter() {
    let installable = this.installAfter;
    while ( installable !== undefined && installable.isSkipped()) {
      installable = installable.installAfter;
    }
    return installable;
  }

  thenInstall(installer) {
    installer.installAfter = this;
    return installer;
  }

  setup(progress, success ) {
    progress.setStatus('Setting up');
    progress.setComplete();
    success();
  }

}

export default InstallableItem;
