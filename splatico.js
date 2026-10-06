/* Splatico Blockbench plugin. Install this file with Plugins > Load Plugin from File. */
(function () {
    'use strict';
    const owned = [];
    let originalTextureDialog, splaticoTextureDialog;
    const isSplatico = () => Format && ['splatico_prop', 'splatico_asset'].includes(Format.id);
    const isAsset = () => Format.id === 'splatico_asset';
    const fail = message => { throw new Error(message); };
    const integer = n => Number.isFinite(n) && Number.isInteger(n);

    function modelSize() {
        if (!Cube.all.length) return [0, 0, 0];
        const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
        for (const cube of Cube.all) for (let axis = 0; axis < 3; axis++) {
            low[axis] = Math.min(low[axis], cube.from[axis]);
            high[axis] = Math.max(high[axis], cube.to[axis]);
        }
        return high.map((n, i) => (n - low[i]) / 16);
    }

    function automaticGrid() {
        return modelSize().map(n => Math.max(1, Math.ceil(n)));
    }

    function validate(metadata) {
        if (!/^[a-z0-9_]{1,80}$/.test(metadata.id)) fail('ID must use 1-80 lowercase letters, numbers or underscores.');
        if (!metadata.name.trim() || metadata.name.length > 64) fail('Enter a name of 1-64 characters.');
        const grid = automaticGrid();
        if (isAsset() && !grid.every(n => integer(n) && n >= 1 && n <= 128)) fail('The model is too large! Each dimension must fit within 128 metres.');
        if (!Cube.all.length) fail('Add at least one cube.');
        if (Outliner.elements.some(e => !(e instanceof Cube))) fail('Splatico models support cubes only.');
        if (!Texture.all.length || Texture.all.some(t => !integer(t.width) || !integer(t.height)
            || t.width < 1 || t.height < 1 || t.width > 1024 || t.height > 1024 || t.error))
            fail('Textures must be loaded images no larger than 1024 x 1024. Larger atlases are allowed at 16x pixel density.');
        if (![Project.texture_width, Project.texture_height].every(n => integer(n) && n > 0))
            fail('Project UV dimensions must be positive whole numbers.');
        for (const group of Group.all) {
            if (!group.origin.every(integer)) fail(`Group "${group.name}" needs whole-number pivot coordinates.`);
            if (group.rotation.some(n => n !== 0)) fail(`Group "${group.name}" must have zero rest rotation. Animate it instead.`);
            if (group.export === false) fail(`Enable export for group "${group.name}" or remove it.`);
        }
        for (const cube of Cube.all) {
            if (![...cube.from, ...cube.to, ...cube.origin].every(integer) || cube.inflate)
                fail(`Cube "${cube.name}" needs whole-number bounds and pivot, with Inflate set to 0.`);
            if (cube.rotation.some(n => n !== 0)) fail(`Cube "${cube.name}" must have zero rest rotation. Animate its group instead.`);
            if (cube.export === false) fail(`Enable export for cube "${cube.name}" or remove it.`);
            if (cube.to.some((n, i) => n <= cube.from[i])) fail(`Cube "${cube.name}" must have positive size on all axes.`);
            for (const [side, face] of Object.entries(cube.faces)) {
                if (face.texture === null) continue;
                const texture = face.getTexture();
                if (!texture) fail(`Cube "${cube.name}" has an untextured face.`);
                if (!face.uv.every(integer)) fail(`Cube "${cube.name}" needs whole-pixel UV coordinates.`);
                const pixels = face.uv.map((n, i) => n * (i % 2 ? texture.height / Project.texture_height : texture.width / Project.texture_width));
                if (pixels.some(n => Math.abs(n - Math.round(n)) > 0.0001))
                    fail(`Cube "${cube.name}" has UVs between texture pixels. Match the UV size to the image size.`);
                const [x, y, z] = cube.to.map((n, i) => n - cube.from[i]);
                let size = side === 'up' || side === 'down' ? [x, z] : side === 'east' || side === 'west' ? [z, y] : [x, y];
                if (face.rotation % 180) size.reverse();
                if (Math.abs(pixels[2] - pixels[0]) > size[0] + .0001 || Math.abs(pixels[3] - pixels[1]) > size[1] + .0001)
                    fail(`Cube "${cube.name}" exceeds 16x pixel density. Generate its texture template at 16x.`);
            }

        }
        const animations = Animation.all;
        if (isAsset() && animations.length) fail('Static assets cannot contain animations.');
        if (!isAsset()) {
            if (animations.length > 2 || animations.some(a => !['idle', 'move'].includes(a.name))
                || new Set(animations.map(a => a.name)).size !== animations.length)
                fail('Use only the optional animations "idle" and "move", one of each.');
            if (animations.some(a => a.loop !== 'loop' || a.length <= 0 || a.length > 60)) fail('Animations must loop and last between 1 and 60 seconds.');
        }
    }

    function defaults() {
        return { name: Project.name || (isAsset() ? 'Wooden Chair' : 'Wooden Crate'),
            id: Project.splatico_id || 'wooden_' + (isAsset() ? 'chair' : 'crate'),
            collision: Project.splatico_collision !== false };
    }

    function form(values) {
        const fields = {
            name: { label: 'Name', type: 'text', value: values.name },
            id: { label: 'ID', type: 'text', value: values.id },
        };
        // Grass, flowers and other foliage should be walk-through, so players do not snag on them.
        if (isAsset()) fields.collision = { label: 'Players collide with it', type: 'checkbox', value: values.collision !== false };
        return fields;
    }

    function remember(data) {
        Project.name = data.name.trim();
        Project.splatico_id = data.id;
        if (isAsset()) Project.splatico_collision = data.collision !== false;
    }

    async function compile(data = defaults()) {
        if (!isSplatico()) fail('Open a Splatico Prop or Asset project first.');
        const project = Project;
        const asset = isAsset();
        validate(data);
        const grid = asset ? automaticGrid() : null;
        const tagged = [];
        for (const texture of Texture.all) {
            const used = Cube.all.some(cube => Object.values(cube.faces).some(face => face.texture === texture.uuid));
            const map = used && texture.render_mode === 'emissive' ? texture.getOwnMaterial()?.map : null;
            if (!map) continue;
            tagged.push([map, map.name]);
            map.name = EMISSIVE_TAG + texture.uuid;
        }
        let glb;
        try {
            glb = await Codecs.gltf.compile({ encoding: 'binary', scale: 16,
                embed_textures: true, animations: !asset, armature: false });
        } finally {
            for (const [map, name] of tagged) map.name = name;
        }
        if (Project !== project) fail('The active project changed during export. Try again.');
        if (!(glb instanceof ArrayBuffer)) fail('Blockbench did not return a binary GLB.');
        glb = wrapSceneRoot(glb, json => markEmissive(json, tagged.length));
        if (glb.byteLength > 16 * 1024 * 1024) fail('The exported model exceeds 16 MB.');
        const zip = new JSZip();
        const manifest = { schema: 1, kind: asset ? 'core_asset' : 'prop', id: data.id, displayName: data.name.trim() };
        if (asset) { manifest.gridSize = grid; manifest.model = data.id + '.glb'; }
        if (asset && data.collision === false) manifest.collision = false;
        if (asset && seats().length) manifest.seats = manifestSeats();
        zip.file(asset ? data.id + '.manifest.json' : 'manifest.json', JSON.stringify(manifest, null, 2));
        zip.file(asset ? data.id + '.glb' : 'model.glb', glb);
        return zip.generateAsync({ type: 'blob', compression: 'STORE' });
    }

    const EMISSIVE_TAG = 'splatico_emissive:';

    const FACINGS = { north: ['Front (-Z)', 0], south: ['Back (+Z)', 180], west: ['-X', 90], east: ['+X', -90] };
    const seats = () => Array.isArray(Project.splatico_seats) ? Project.splatico_seats : [];

    function manifestSeats() {
        const low = [0, 1, 2].map(axis => Math.min(...Cube.all.map(cube => cube.from[axis])));
        return seats().slice(0, 16).map(([x, y, z, yaw]) =>
            [(x - low[0]) / 16, (y - low[1]) / 16, (z - low[2]) / 16, yaw].map(n => Math.round(n * 10000) / 10000));
    }

    function seatsOnCube(cube, facing, count) {
        const yaw = FACINGS[facing][1];
        const along = facing === 'north' || facing === 'south' ? 0 : 2;
        const depth = 2 - along;
        const width = cube.to[along] - cube.from[along];
        const inset = Math.min(2.7, (cube.to[depth] - cube.from[depth]) / 2);
        const front = facing === 'north' ? cube.from[2] + inset : facing === 'south' ? cube.to[2] - inset
            : facing === 'west' ? cube.from[0] + inset : cube.to[0] - inset;
        const n = count > 0 ? count : Math.max(1, Math.floor((width + 2) / 14));
        const result = [];
        for (let i = 0; i < n; i++) {
            const point = [0, cube.to[1], 0];
            point[along] = cube.from[along] + width * (i + .5) / n;
            point[depth] = front;
            result.push([...point, yaw]);
        }
        return result;
    }

    function addSeats() {
        const cubes = Cube.selected.slice();
        if (!cubes.length) {
            Blockbench.showMessageBox({ title: 'Add seats', message: 'Select the seat surface.' });
            return;
        }
        new Dialog({ id: 'splatico_seats', title: 'Add Seats',
            lines: [`${seats().length} seat(s) marked.`],
            form: {
                facing: { label: 'Sitter faces', type: 'select', value: 'north',
                    options: Object.fromEntries(Object.entries(FACINGS).map(([key, [label]]) => [key, label])) },
                count: { label: 'Seats per cube', type: 'number', value: 0, min: 0, max: 8, step: 1 },
            },
            onConfirm(data) {
                const added = cubes.flatMap(cube => seatsOnCube(cube, data.facing, data.count));
                Project.splatico_seats = seats().concat(added).slice(0, 16);
                Project.saved = false;
                Blockbench.showQuickMessage(`${Project.splatico_seats.length} seat(s) marked`);
            },
        }).show();
    }

    function clearSeats() {
        Project.splatico_seats = [];
        Project.saved = false;
        Blockbench.showQuickMessage('Seats cleared');
    }

    function markEmissive(json, expected) {
        let marked = 0;
        for (const material of json.materials || []) {
            const index = material.pbrMetallicRoughness?.baseColorTexture?.index;
            const texture = index === undefined ? null : json.textures?.[index];
            if (!texture?.name?.startsWith(EMISSIVE_TAG)) continue;
            material.emissiveTexture = { index };
            material.emissiveFactor = [1, 1, 1];
            marked++;
        }
        for (const texture of json.textures || [])
            if (texture.name?.startsWith(EMISSIVE_TAG)) delete texture.name;
        if (expected && !marked) fail('An emissive texture could not be marked in the export. Check that it is applied to a face.');
    }

    function wrapSceneRoot(glb, edit) {
        const view = new DataView(glb);
        const oldLength = view.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, oldLength)));
        edit?.(json);
        for (const scene of json.scenes) {
            const index = json.nodes.length;
            json.nodes.push({ name: 'SplaticoRoot', children: scene.nodes });
            scene.nodes = [index];
        }
        const encoded = new TextEncoder().encode(JSON.stringify(json));
        const length = Math.ceil(encoded.length / 4) * 4;
        const tail = new Uint8Array(glb, 20 + oldLength);
        const result = new Uint8Array(20 + length + tail.length);
        result.set(new Uint8Array(glb, 0, 20));
        result.fill(32, 20, 20 + length);
        result.set(encoded, 20);
        result.set(tail, 20 + length);
        const header = new DataView(result.buffer);
        header.setUint32(8, result.length, true);
        header.setUint32(12, length, true);
        return result.buffer;
    }

    function exportPackage() {
        const asset = isAsset();
        new Dialog({ id: 'splatico_export', title: 'Export Splatico ' + (asset ? 'Asset' : 'Prop'),
            form: form(defaults()),
            lines: [asset ? `Size in game: ${modelSize().map(n => Number(n.toFixed(3))).join(' x ')} metres. Placement size is calculated automatically. Seats: ${seats().length} (Tools → Add Seats).`
                : 'Add an animation.'],
            async onConfirm(data) {
                try {
                    const content = await compile(data);
                    remember(data);
                    Blockbench.export({ type: 'Splatico ' + (asset ? 'Asset' : 'Prop'),
                        extensions: [asset ? 'splticoasset' : 'splticoprop'], name: data.id, content, savetype: 'zip' });
                } catch (error) { Blockbench.showMessageBox({ title: 'Cannot export Splatico model', message: error.message, icon: 'error' }); }
            },
        }).show();
    }

    function template(asset) {
        Project.texture_width = Project.texture_height = 16;
        updateProjectResolution();
        // Embedded copies of the game's existing crate and chair textures.
        const source = asset ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABCUlEQVR4AYSSPYpCMRSFQ4qpBWeY2cBUNnba6WZcg5uxdCHaWVpoZS0oKljbKF/gC5fgH3ze5Nz78nIOL2/m0/snZpPBy5l8vZwSpOaHJofjrXTdx5o73Z8ETOy26ySnw77o9P5+v2jXPZrk1XKR5HK+lkH/PIy9M1R1ah6OxgkYov73+qkFPRL7NYN3PvXMSyLoNYN3PvXLw1xbyKlkgND97tQA2eM1ggYcImRWMoieXEfPrNV5yDV6zQA/4hus6tQ2q5qBPqk8yHUFr+jQZpUdokbPXJWDhD6wj3NZP1Q8CYNoLfatmcEIPqH1ivaMcgBXE/22XvH/jPId4Fe4DYfF7yJ6Zk1fHgAAAP//xQnrBgAAAAZJREFUAwA9iHJYI7zDmAAAAABJRU5ErkJggg==" : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA6ElEQVR4AaRSOwrCQBBdtrAOxGDA2srGziN4D8EziMewt7T3Eh7AwlTWghgDuUHMG3jJ7CiyEvHN7+18iT/tVs0/uB63zXm/Fhw2y8bP5gtHFMVT7CyfOvyqVy0+efiIA0maQTkvshW34tLK/o8kepZDvK5KqL6AeJGifNy7l90EuiNY3dVy4ImuAAL5ZATldAcJGMEbIRwUQCAWH0fUibqDjms7OKLeVz/Stn3DNWUFeySSuoC1OaUUsOQ33zbhG4/RiHScONgk6SMGwCdHHXzK6PILHJvJKBi9Aq/OZOroAkywenCBNwAAAP//D4hfrQAAAAZJREFUAwDmLG+hN5UuGAAAAABJRU5ErkJggg==";
        const texture = new Texture({ name: asset ? 'wood.png' : 'crate_wood_16.png' }).fromDataURL(source).add(false);
        const root = new Group({ name: 'root', origin: [0, 0, 0] }).init();
        function cube(name, from, to) {
            const c = new Cube({ name, from, to, origin: [0, 0, 0], box_uv: false, autouv: 0 }).addTo(root).init();
            const [x, y, z] = to.map((n, i) => n - from[i]);
            for (const [side, face] of Object.entries(c.faces)) {
                face.texture = texture.uuid;
                const size = side === 'up' || side === 'down' ? [x, z] : side === 'east' || side === 'west' ? [z, y] : [x, y];
                face.uv = [0, 0, ...size];
            }
        }
        if (asset) {
            cube('Seat', [-6, 6, -6], [6, 8, 6]);
            for (const x of [-6, 4]) for (const z of [-6, 4]) cube('Leg', [x, 0, z], [x + 2, 6, z + 2]);
            cube('Back left', [-6, 8, 4], [-4, 16, 6]);
            cube('Back right', [4, 8, 4], [6, 16, 6]);
            cube('Back slat', [-4, 12, 4], [4, 15, 6]);
            Project.splatico_seats = [[0, 8, -3.3, 0]];
        } else {
            cube('Crate', [-7, 1, -7], [7, 15, 7]);
            cube('Lower frame', [-8, 0, -8], [8, 2, 8]);
            cube('Upper frame', [-8, 14, -8], [8, 16, 8]);
            for (const x of [-8, 6]) for (const z of [-8, 6]) cube('Corner', [x, 2, z], [x + 2, 14, z + 2]);
        }
        Canvas.updateAll();
    }

    function newModel(asset) {
        const initial = { name: asset ? 'Wooden Chair' : 'Wooden Crate', id: asset ? 'wooden_chair' : 'wooden_crate' };
        const fields = form(initial);
        if (!asset) {
            fields.idle = { label: 'Add optional idle animation', type: 'checkbox', value: false };
            fields.move = { label: 'Add optional move animation', type: 'checkbox', value: false };
        }
        new Dialog({ id: 'splatico_new', title: 'New Splatico ' + (asset ? 'Asset' : 'Prop'), form: fields,
            lines: ['Use 16x pixel density.'],
            onConfirm(data) {
                if (!/^[a-z0-9_]{1,80}$/.test(data.id) || !data.name.trim()) {
                    Blockbench.showMessageBox({ title: 'Invalid project details', message: 'Use a name and a lowercase ID.' });
                    return;
                }
                if (!newProject(Formats[asset ? 'splatico_asset' : 'splatico_prop'])) return;
                remember(data);
                template(asset);
                if (!asset) for (const name of ['idle', 'move']) if (data[name]) {
                    const animation = new Animation({ name, loop: 'loop', length: 1 }).add();
                    const animator = animation.getBoneAnimator(Group.all[0]);
                    for (const [time, angle] of [[0, 0], [.25, name === 'idle' ? 2 : 8], [.75, name === 'idle' ? -2 : -8], [1, 0]])
                        animator.addKeyframe({ channel: 'rotation', time, data_points: [{ x: 0, y: angle, z: 0 }] });
                }
            },
        }).show();
    }

    Plugin.register('splatico', {
        title: 'Splatico', author: 'Splatico', description: 'Create props and assets for Splatico.',
        icon: 'view_in_ar', version: '1.0.8', min_version: '5.0.0', variant: 'both',
        onload() {
            Language.addTranslations('en', { 'format_category.splatico': 'Splatico' });
            originalTextureDialog = TextureGenerator.addBitmapDialog;
            splaticoTextureDialog = function (callback) {
                if (!isSplatico()) return originalTextureDialog.call(this, callback);
                const result = originalTextureDialog.call(this, callback);
                if (Dialog.open?.id === 'add_bitmap') {
                    Dialog.open.setFormValues({ type: 'template', resolution: '16',
                        rearrange_uv: true, double_use: false, box_uv: false });
                }
                return result;
            };
            TextureGenerator.addBitmapDialog = splaticoTextureDialog;
            owned.push(new Property(ModelProject, 'string', 'splatico_id', { default: '' }));
            owned.push(new Property(ModelProject, 'boolean', 'splatico_collision', { default: true }));
            owned.push(new Property(ModelProject, 'array', 'splatico_seats', { default: [] }));
            for (const asset of [false, true]) {
                const id = asset ? 'splatico_asset' : 'splatico_prop';
                const codec = new Codec(id, { name: asset ? 'Splatico Asset' : 'Splatico Prop',
                    extension: asset ? 'splticoasset' : 'splticoprop', compile, export: exportPackage });
                const format = new ModelFormat(id, { name: codec.name, icon: asset ? 'chair' : 'inventory_2',
                    description: asset ? 'Static map assets.' : 'Props players disguise as.',
                    category: 'splatico', target: 'Splatico', codec, centered_grid: true, bone_rig: true,
                    integer_size: true, box_uv: false, optional_box_uv: false, rotate_cubes: false,
                    meshes: false, single_texture: false, uv_rotation: true, animation_mode: !asset,
                    onSetup(project, isNew) {
                        if (isNew) {
                            project.texture_width = project.texture_height = 16;
                            updateProjectResolution();
                        }
                    },
                    new() { newModel(asset); } });
                codec.format = format;
                owned.push(codec, format);
                const action = new Action('new_' + id, { name: 'New ' + codec.name, icon: format.icon, click() { newModel(asset); } });
                owned.push(action);
                MenuBar.addAction(action, 'file');
            }
            const action = new Action('export_splatico', { name: 'Export Splatico Package', icon: 'archive', condition: isSplatico, click: exportPackage });
            owned.push(action);
            MenuBar.addAction(action, 'file.export');
            for (const seatAction of [
                new Action('splatico_add_seats', { name: 'Add Seats on Selected Cubes', icon: 'event_seat', condition: () => isSplatico() && isAsset(), click: addSeats }),
                new Action('splatico_clear_seats', { name: 'Clear Seats', icon: 'event_busy', condition: () => isSplatico() && isAsset(), click: clearSeats }),
            ]) {
                owned.push(seatAction);
                MenuBar.addAction(seatAction, 'tools');
            }
        },
        onunload() {
            if (TextureGenerator.addBitmapDialog === splaticoTextureDialog)
                TextureGenerator.addBitmapDialog = originalTextureDialog;
            owned.reverse().forEach(item => item.delete()); owned.length = 0;
        },
    });
})();
