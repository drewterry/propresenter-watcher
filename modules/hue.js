const v3 = require('node-hue-api').v3,
  discovery = require('node-hue-api').discovery,
  api = v3.api,
  GroupLightState = v3.lightStates.GroupLightState;

const retry = require('retry');

const { Module, ModuleTrigger, ModuleTriggerArg } = require('./module.js');

class HueController extends Module {
  static name = 'hue';
  static niceName = 'Hue Light Controller';

  static create(config) {
    return new HueController(config);
  }

  constructor(config) {
    super(config);

    // hue_scene[scene]
    this.registerTrigger(
      new ModuleTrigger(
        'hue_scene',
        'update hue group ',
        [
          new ModuleTriggerArg(
            'scene',
            'string',
            'name of a scene configured in the hue app',
            false,
          ),
          new ModuleTriggerArg(
            'transition',
            'number',
            'transition time in milliseconds.  default: 400ms',
            true,
          ),
        ],
        (_, scene, transition) => this.setScene(scene, transition),
      ),
    );

    this.updateConfig(config);
  }

  async updateConfig(config) {
    console.log('NEW HUE CONFIG: ');
    console.log(JSON.stringify(config));
    super.updateConfig(config);

    let { user, group, host, discoverBridge } = this.config;
    this.user = user;
    this.group = group;

    // setup connections
    if (discoverBridge) {
      this.host = await this.discoverBridge();
    } else {
      this.host = host;
    }

    if (this.user) {
      await this.initClient();
    } else {
      await this.createUser();
      await this.authenticateUser();
    }

    await this.getScenes();

    console.log('HUE CONFIGURED SCENES: ');
    console.log(this.scenes);
  }

  async discoverBridge() {
    const discoveryResults = await discovery.nupnpSearch();

    if (discoveryResults.length === 0) {
      console.error('Failed to resolve any Hue Bridges');
      return null;
    } else {
      // Ignoring that you could have more than one Hue Bridge on a network as this is unlikely in 99.9% of users situations
      return discoveryResults[0].ipaddress;
    }
  }

  async initClient() {
    this.client = await api.createLocal(this.host).connect(this.user);
  }

  async getScenes() {
    this.scenes = (await this.client.scenes.getAll())
      .filter((scene) => scene.group === this.group)
      .reduce(
        (scenes, scene) => ({
          ...scenes,
          [scene.name]: scene.id,
        }),
        {},
      );
  }

  async createUser() {
    // Create an unauthenticated instance of the Hue API so that we can create a new user
    const unauthenticatedApi = await api.createLocal(this.host).connect();

    try {
      const { username } = await unauthenticatedApi.users.createUser('propresenter-watcher');
      this.user = username;

      console.log(
        '*******************************************************************************\n',
      );
      console.log(
        'User has been created on the Hue Bridge. The following username can be used to\n' +
          'authenticate with the Bridge and provide full local access to the Hue Bridge.\n' +
          'YOU SHOULD TREAT THIS LIKE A PASSWORD\n',
      );
      console.log(`Hue Bridge User: ${username}`);
      console.log(
        '*******************************************************************************\n',
      );
    } catch (err) {
      if (err.getHueErrorType() === 101) {
        console.log('EEEEEE');
      } else {
        console.error(`Unexpected Error: ${err.message}`);
      }
    }
  }

  async authenticateUser() {
    await this.initClient();

    const operation = retry.operation({
      forever: true,
      maxTimeout: 1000,
    });

    operation.attempt(async (count) => {
      try {
        console.log('Hue Auth Attempt: ', count);
        const bridgeConfig = await this.client.configuration.getConfiguration();
        console.log(`Connected to Hue Bridge: ${bridgeConfig.name} :: ${bridgeConfig.ipaddress}`);
      } catch (err) {
        console.error(err);
        if (err.getHueErrorType() === 101) {
          console.error(
            'The Link button on the bridge was not pressed. Please press the Link button and try again.',
          );
        } else {
          console.error(`Unexpected Error: ${err.message}`);
        }
      }
    });
  }

  setScene(scene, transition) {
    console.log('HUE: SET SCENE: ', scene);
    const groupState = new GroupLightState()
      .scene(this.scenes[scene])
      .transitionInMillis(transition || 400);
    this.client.groups.setGroupState(this.group, groupState);
  }
}

module.exports.HueController = HueController;
