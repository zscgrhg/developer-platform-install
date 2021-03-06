'use strict';

import path from 'path';
import Logger from '../services/logger';
import InstallableItem from './installable-item';
import Platform from '../services/platform';
import Installer from './helpers/installer';
import globby from 'globby';
import fs from 'fs-extra';
import pify from 'pify';

class CDKInstall extends InstallableItem {
  constructor(installerDataSvc, targetFolderName, minishiftUrl, fileName, minishiftSha256) {
    super(CDKInstall.KEY, minishiftUrl, fileName, targetFolderName, installerDataSvc, true);

    this.sha256 = minishiftSha256;
    this.addOption('install', this.version, '', true);
    this.selected = false;
  }

  static get KEY() {
    return 'cdk';
  }

  get minishiftExeLocation() {
    return path.join(this.installerDataSvc.ocDir(), Platform.OS === 'win32' ? 'minishift.exe' : 'minishift');
  }

  installAfterRequirements(progress, success, failure) {
    progress.setStatus('Installing');
    let minishiftExe = this.minishiftExeLocation;
    let installer = new Installer(CDKInstall.KEY, progress, success, failure);
    let ocExe;
    let ocExePattern = Platform.OS === 'win32' ? '/**/oc.exe' : '/**/oc';
    let home;
    let driverName = 'virtualbox';
    return Promise.resolve().then(()=> {
      if(this.downloadedFile.endsWith('.exe') || path.parse(this.downloadedFile).ext == '') {
        return installer.copyFile(this.downloadedFile, minishiftExe);
      }
      return Promise.reject('Cannot process downloaded cdk distribution');
    }).then(()=> {
      return Platform.makeFileExecutable(minishiftExe);
    }).then(()=> {
      let hv = this.installerDataSvc.getInstallable('hyperv');
      if (hv && hv.hasOption('detected')) {
        driverName = 'hyperv';
        return installer.exec(
          'net localgroup "Hyper-V Administrators" %USERDOMAIN%\\%USERNAME% /add'
        ).catch(()=>Promise.resolve());
      }
      return Promise.resolve();
    }).then(()=> {
      return installer.exec(
        `${minishiftExe} stop`
      ).catch(()=>Promise.resolve());
    }).then(()=> {
      return installer.exec(`${minishiftExe} setup-cdk --force --default-vm-driver=${driverName}`, this.createEnvironment());
    }).then(()=> {
      return Platform.getUserHomePath();
    }).then((result)=> {
      home = Platform.ENV.MINISHIFT_HOME ? Platform.ENV.MINISHIFT_HOME : path.join(result, '.minishift');
      return globby(ocExePattern, {root: path.join(home, 'cache', 'oc')});
    }).then((files)=> {
      ocExe = files[0].replace(/\//g, path.sep);
      return Promise.resolve();
    }).then(()=> {
      return Platform.makeFileExecutable(ocExe);
    }).then(()=> {
      return Platform.addToUserPath([ocExe, minishiftExe]);
    }).then(()=> {
      return pify(fs.appendFile)(
        path.join(home, 'cdk'),
        `rhel.subscription.username=${this.installerDataSvc.username}`);
    }).then(()=> {
      installer.succeed(true);
    }).catch((error)=> {
      installer.fail(error);
    });
  }

  createEnvironment() {
    let vboxInstall = this.installerDataSvc.getInstallable('virtualbox');
    let cygwinInstall = this.installerDataSvc.getInstallable('cygwin');
    let env = Object.assign({}, Platform.ENV);
    let newPath = [];
    let oldPath = Platform.ENV[Platform.PATH];

    if(vboxInstall) {
      newPath.push(vboxInstall.getLocation());
    }

    if(cygwinInstall) {
      newPath.push(cygwinInstall.getLocation());
    }

    if(oldPath.trim()) {
      newPath.push(oldPath);
    }

    env[Platform.PATH] = newPath.join(path.delimiter);
    Logger.info(CDKInstall.KEY + ' - Set PATH environment variable to \'' + env[Platform.PATH] + '\'');
    return env;
  }

}

export default CDKInstall;
