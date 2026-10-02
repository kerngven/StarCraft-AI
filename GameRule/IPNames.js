/* Product-facing aliases. Engine constructor names stay stable for replay compatibility. */
var IPNames={
    SCV:'Builder', Drone:'Harvester', Probe:'Surveyor', Marine:'Rifle', Firebat:'Flare', Zealot:'Blade', Zergling:'Skitter', Hydralisk:'Spitter',
    CommandCenter:'Forward Base', Hatchery:'Brood Base', Nexus:'Core Base', Refinery:'Fuel Works', Extractor:'Gas Siphon', Assimilator:'Gas Array',
    Barracks:'Rifle Hall', Gateway:'War Gate', SpawningPool:'Spawn Pit', SupplyDepot:'Supply Cache', Pylon:'Relay Spire', Overlord:'Carrier',
    defaultName:function(name){ return IPNames[name]||name; }
};
