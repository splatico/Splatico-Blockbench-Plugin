# Splatico Blockbench plugin

Install `splatico.js` in Blockbench 5.0 or later: **File → Plugins → Load Plugin from File**.
The plugin also works in the web version. To start, go to **File → New Splatico Prop** or **File → New Splatico Asset**.

1. Create a **Splatico Prop** for players to disguise as, or a **Splatico Asset** for static scenery. For blocks and decals, please use the built-in importer within Splatico.
2. Enter a display name and lowercase ID. Asset placement size is calculated automatically.
3. Edit the starter crate or chair to see how it works.
4. Save an editable **Blockbench project (.bbmodel)** with File → Save Project.
5. Choose **File → Export → Export Splatico Package**.
6. In Splatico's map editor, open **Props → Import** or **Assets → Import** and choose the exported package.

Use `.bbmodel` to edit the model later and the new `.splticoprop` or `.splticoasset` file to import into the game.

## Modelling rules

- Try to use whole numbers when sizing blocks to keep within the design language of the game.
- Rotate groups in animations. Assets are static and do not contain animations.
- Use **16× pixel density**, with whole-pixel UV coordinates.

## Emissions

To add emissions like a lamp shade or screen, right-click that texture in the
Textures panel and choose **Render Mode → Emissive**.

## Asset Collision

To disable collision on your asset, at export untick the **Players collide with it** checkbox. This is useful for assets you wish players, props etc to walk through.

## Seats

Players can use the interact keybind to sit on surfaces. Select your surface in and navigate to **Tools → Add Seats on Selected Cubes**

**Tools → Clear Seats** removes them. You can check the starter chair model as an example.

## Prop Animations

Navigate to the Blockbench animation tab and use **idle** or **move** to edit the respective animations. These animations are optional but can give props a bit more life. Both **must** loop, and at most, no longer than 60 seconds long.

## Support

For support, head to our [Discord](https://discord.gg/rERbGPRPUy) for community help!