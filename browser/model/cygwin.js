'use strict';

let path = require('path');

import InstallableItem from './installable-item';
import Installer from './helpers/installer';
import Util from './helpers/util';
import Platform from '../services/platform';
import fs from 'fs-extra';

class CygwinInstall extends InstallableItem {
  constructor(installerDataSvc, targetFolderName, downloadUrl, fileName, sha256) {
    super(CygwinInstall.KEY, downloadUrl, fileName, targetFolderName, installerDataSvc, false);
    this.cygwinPathScript = path.join(this.installerDataSvc.tempDir(), 'set-cygwin-path.ps1');
    this.addOption('install', this.version, '', true);
    if(Platform.OS !== 'win32') {
      this.selectedOption = 'detected';
      this.addOption('detected', '', '', true);
    }
    this.sha256 = sha256;
  }

  static get KEY() {
    return 'cygwin';
  }

  detectExistingInstall() {
    if (Platform.OS === 'win32') {
      let cygwinPackageRegex = /cygwin\s*(\d+\.\d+\.\d+)/;
      let opensshPackageReqex = /openssh\s*(\d+\.\d+)/;
      let rsyncPackageRegex = /rsync\s*(\d+\.\d+\.\d+)/;
      return Util.executeCommand('cygcheck -c cygwin openssh rsync').then((out)=>{
        let cygwinVersion = cygwinPackageRegex.exec(out)[1];
        opensshPackageReqex.exec(out)[1];
        rsyncPackageRegex.exec(out)[1];
        this.addOption('detected', '', '', true);
        this.option['detected'].version = cygwinVersion;
        this.selectedOption = 'detected';
      }).then(()=>{
        return Util.executeCommand('where cygcheck', 1);
      }).then((output)=>{
        this.option['detected'].location = path.parse(output.split('\n')[0]).dir;
      }).catch(()=>{
        if(this.option.detected) {
          delete this.option.detected;
        }
        this.selectedOption = 'install';
        return Promise.resolve();
      });
    } else {
      return Promise.resolve();
    }
  }

  installAfterRequirements(progress, success, failure) {
    progress.setStatus('Installing');
    let originalExecFile = path.join(this.installerDataSvc.cygwinDir(), 'setup-x86_64.exe');
    let installer = new Installer(CygwinInstall.KEY, progress, success, failure);
    let packagesFolder = path.join(this.installerDataSvc.cygwinDir(), 'packages');
    let rootFolder = this.installerDataSvc.cygwinDir();

    let originalExecFileEscaped = originalExecFile
      .replace(/'/g, '\'\'')
      .replace(/\[/g, '`[')
      .replace(/\]/g, '`]');

    packagesFolder = packagesFolder
      .replace(/'/g, '\'\'');

    rootFolder = rootFolder
      .replace(/'/g, '\'\'');

    let cygwinArgs = `--no-admin --quiet-mode --only-site -l ${packagesFolder} --site http://mirrors.xmission.com/cygwin --root ${rootFolder} --categories Base --packages openssh,rsync`;
    let localPackages = path.join(this.bundleFolder, 'packages');
    if(fs.existsSync(localPackages)) {
      cygwinArgs = cygwinArgs + ` -L -l ${localPackages}`;
    }
    let startProcess = `$p = Start-Process -ErrorAction stop -WindowStyle hidden -PassThru -wait -FilePath '${originalExecFileEscaped}' -ArgumentList '${cygwinArgs}'; exit $p.ExitCode;`;
    let powershellCommand = `powershell -Command "${startProcess}"`;

    return installer.copyFile(
      this.downloadedFile, originalExecFile, true
    ).then(()=>{
      return installer.exec(powershellCommand);
    }).then(() => {
      return Platform.addToUserPath([path.join(this.installerDataSvc.cygwinDir(), 'bin')]);
    }).then(() => {
      installer.succeed(true);
    }).catch((error) => {
      installer.fail(error);
    });
  }
}

export default CygwinInstall;
