'use strict';

import * as neo4j from '../vendor/neo4j-javascript-driver/lib/browser/neo4j-web.js';
import * as vis from '../vendor/vis/dist/vis-network.min.js';
import '../vendor/vis/dist/vis-network.min.css';
import { defaults } from './defaults';
import { EventController, CompletionEvent } from './events';


//self
//import {Spinner} from 'spin.js';

export default class NeoVis {

    /**
     *
     * @constructor
     * @param {object} config - configures the visualization and Neo4j server connection
     *  {
     *    container:
     *    server_url:
     *    server_password?:
     *    server_username?:
     *    labels:
     *
     *  }
     *
     */


    constructor(config) {
        console.log(config);
        console.log(defaults);

        this._config = config;
        this._encrypted = config.encrypted || defaults['neo4j']['encrypted'];
        this._trust = config.trust || defaults.neo4j.trust;
        this._driver = neo4j.v1.driver(config.server_url || defaults.neo4j.neo4jUri, neo4j.v1.auth.basic(config.server_user || defaults.neo4j.neo4jUser, config.server_password || defaults.neo4j.neo4jPassword), {encrypted: this._encrypted, trust: this._trust});
        this._query =   config.initial_cypher || defaults.neo4j.initialQuery;
        this._nodes = {};
        this._edges = {};
        this._data = {};
        this._network = null;
        this._container = document.getElementById(config.container_id);
        this._events = new EventController();
    }

    _addNode(node) {
        this._nodes[node.id] = node;
    }

    _addEdge(edge) {
        this._edges[edge.id] = edge;
    }

    /**
     * Build node object for vis from a neo4j Node
     * FIXME: use config
     * FIXME: move to private api
     * @param n
     * @returns {{}}
     */
     buildNodeVisObject(n) {

        var self = this;
        let node = {};
        let label = n.labels[0];

        let captionKey   = this._config && this._config.labels && this._config.labels[label] && this._config.labels[label]['caption'],
            sizeKey = this._config && this._config.labels && this._config.labels[label] && this._config.labels[label]['size'],
            sizeCypher = this._config && this._config.labels && this._config.labels[label] && this._config.labels[label]['sizeCypher'],
            communityKey = this._config && this._config.labels && this._config.labels[label] && this._config.labels[label]['community'];

        node['id'] = n.identity.toInt();
        
        // node size

        if (sizeCypher) {
            // use a cypher statement to determine the size of the node
            // the cypher statement will be passed a parameter {id} with the value
            // of the internal node id

            let session = this._driver.session();
            session.run(sizeCypher, {id: neo4j.v1.int(node['id'])})
                .then(function(result) {
                    result.records.forEach(function(record) {
                        record.forEach(function(v,k,r) {
                            if (typeof v === "number") {
                                self._addNode({id: node['id'], value: v});
                            } else if (v.constructor.name === "Integer") {
                                self._addNode({id: node['id'], value: v.toNumber()})
                            }
                        })
                    })
                })


        } else if (typeof sizeKey === "number") {
            node['value'] = sizeKey;
        } else {

            let sizeProp = n.properties[sizeKey];

            if (sizeProp && typeof sizeProp === "number") {
                // propety value is a number, OK to use
                node['value'] = sizeProp;
            } else if (sizeProp && typeof sizeProp === "object" && sizeProp.constructor.name === "Integer") {
                // property value might be a Neo4j Integer, check if we can call toNumber on it:
                if (sizeProp.inSafeRange()) {
                    node['value'] = sizeProp.toNumber();
                } else {
                    // couldn't convert to Number, use default
                    node['value'] = 1.0;
                }
            } else {
                node['value'] = 1.0;
            }
        }

        // node caption
        if (typeof captionKey === "function") {
            node['label'] = captionKey(n);
        }
        else {
            node['label'] = n.properties[captionKey] || label || "";
        }

        // community
        // behavior: color by value of community property (if set in config), then color by label
        if (!communityKey) {
            node['group'] = label;
        } else {
            try {
                if (n.properties[communityKey]) {
                    node['group'] = n.properties[communityKey].toNumber() || label || 0;  // FIXME: cast to Integer

                }
                else {
                    node['group'] = 0;
                }

            } catch(e) {
                node['group'] = 0;
            }

            
        }


        // set all properties as tooltip
        node['title'] = "";
        for (let key in n.properties) {
            node['title'] += "<strong>" + key + ":</strong>" + " " + n.properties[key] + "<br>";
        }
        return node;
    }

    /**
     * Build edge object for vis from a neo4j Relationship
     * @param r
     * @returns {{}}
     */
    buildEdgeVisObject(r) {

        let weightKey = this._config && this._config.relationships && this._config.relationships[r.type] && this._config.relationships[r.type]['thickness'],
            captionKey = this._config && this._config.relationships && this._config.relationships[r.type] && this._config.relationships[r.type]['caption'];

        let edge = {};
        edge['id'] = r.identity.toInt();
        edge['from'] = r.start.toInt();
        edge['to'] = r.end.toInt();

        // hover tooltip. show all properties in the format <strong>key:</strong> value
        edge['title'] = "";
        for (let key in r.properties) {
            edge['title'] += "<strong>" + key + ":</strong>" + " " + r.properties[key] + "<br>";
        }

        // set relationship thickness
        if (weightKey && typeof weightKey === "string") {
            edge['value'] = r.properties[weightKey];
        } else if (weightKey && typeof weightKey === "number") {
            edge['value'] = weightKey;
        } else {
            edge['value'] = 1.0;
        }

        // set caption


        if (typeof captionKey === "boolean") {
            if (!captionKey) {
                edge['label'] = "";
            } else {
                edge['label'] = r.type;
            }
        } else if (captionKey && typeof captionKey === "string") {
            edge['label']  = r.properties[captionKey] || "";
        } else {
            edge['label'] = r.type;
        }

        return edge;
    }

    // public API

    render() {

        // connect to Neo4j instance
        // run query


    var opts = {
        lines: 15, // The number of lines to draw
        length: 20, // The length of each line
        width: 12, // The line thickness
        radius: 16, // The radius of the inner circle
        scale: 1, // Scales overall size of the spinner
        corners: 1, // Corner roundness (0..1)
        color: '#456789', // CSS color or array of colors
        fadeColor: 'transparent', // CSS color or array of colors
        speed: 1, // Rounds per second
        rotate: 0, // The rotation offset
        animation: 'spinner-line-fade-more', // The CSS animation name for the lines
        direction: 1, // 1: clockwise, -1: counterclockwise
        zIndex: 2e9, // The z-index (defaults to 2000000000)
        className: 'spinner', // The CSS class to assign to the spinner
        top: '500%', // Top position relative to parent
        left: '720%', // Left position relative to parent
        shadow: '0 0 1px transparent', // Box-shadow for the lines
        position: 'absolute' // Element positioning
      };
      

      //Spinner viz

      var target = document.getElementById('viz');
      var spinner = new Spinner(opts).spin(target);

       //Spinner viz ends



                //Machine-Merger spinner

                var target0 = document.getElementById('viz0');
                var spinner =new Spinner(opts).spin(target0);


                var target1 = document.getElementById('viz1');
                var spinner =new Spinner(opts).spin(target1);


                var target2 = document.getElementById('viz2');
                var spinner =new Spinner(opts).spin(target2);


                var target3 = document.getElementById('viz3');
                var spinner =new Spinner(opts).spin(target3);


                var target4 = document.getElementById('viz4');
                var spinner =new Spinner(opts).spin(target4);


                var target5 = document.getElementById('viz5');
                var spinner =new Spinner(opts).spin(target5);


                var target01 = document.getElementById('viz01');
                var spinner =new Spinner(opts).spin(target01);


                var target11 = document.getElementById('viz11');
                var spinner =new Spinner(opts).spin(target11);


                var target21 = document.getElementById('viz21');
                var spinner =new Spinner(opts).spin(target21);


                var target31 = document.getElementById('viz31');
                var spinner =new Spinner(opts).spin(target31);


                var target41 = document.getElementById('viz41');
                var spinner =new Spinner(opts).spin(target41);


                var target51 = document.getElementById('viz51');
                var spinner =new Spinner(opts).spin(target51);


                var targetSingle = document.getElementById('vizSingle');
                var spinner =new Spinner(opts).spin(targetSingle);


                var targetSingle1 = document.getElementById('vizSingle1');
                var spinner =new Spinner(opts).spin(targetSingle1);


                //-----------  Machine-merger spinner ends  -----------

                //============   Duplicity spinner   ================


                var targetCollection = document.getElementById('vizCollection');
                var spinner =new Spinner(opts).spin(targetCollection);


                var targetExtractNetwork = document.getElementById('vizExtractNetwork');
                var spinner =new Spinner(opts).spin(targetExtractNetwork);


                var targetSingular0 = document.getElementById('vizSingular0');
                var spinner =new Spinner(opts).spin(targetSingular0);


                var targetSingular1 = document.getElementById('vizSingular1');
                var spinner =new Spinner(opts).spin(targetSingular1);


                var targetSingular2 = document.getElementById('vizSingular2');
                var spinner =new Spinner(opts).spin(targetSingular2);


                var targetSingular3 = document.getElementById('vizSingular3');
                var spinner =new Spinner(opts).spin(targetSingular3);


                var targetSingular4 = document.getElementById('vizSingular4');
                var spinner =new Spinner(opts).spin(targetSingular4);


                var targetSingular5 = document.getElementById('vizSingular5');
                var spinner =new Spinner(opts).spin(targetSingular5);


                var targetSingular6 = document.getElementById('vizSingular6');
                var spinner =new Spinner(opts).spin(targetSingular6);


                var targetSingular7 = document.getElementById('vizSingular7');
                var spinner =new Spinner(opts).spin(targetSingular7);


                var targetSingular8 = document.getElementById('vizSingular8');
                var spinner =new Spinner(opts).spin(targetSingular8);


                var targetSingular9 = document.getElementById('vizSingular9');
                var spinner =new Spinner(opts).spin(targetSingular9);



                var targetSingular10 = document.getElementById('vizSingular10');
                var spinner =new Spinner(opts).spin(targetSingular10);


                var targetSingular11 = document.getElementById('vizSingular11');
                var spinner =new Spinner(opts).spin(targetSingular11);


                var targetSingular12 = document.getElementById('vizSingular12');
                var spinner =new Spinner(opts).spin(targetSingular12);



                var targetSingular13 = document.getElementById('vizSingular13');
                var spinner =new Spinner(opts).spin(targetSingular13);


                var targetSingular14 = document.getElementById('vizSingular14');
                var spinner =new Spinner(opts).spin(targetSingular14);


                var targetSingular15 = document.getElementById('vizSingular15');
                var spinner =new Spinner(opts).spin(targetSingular15);


                var targetSingular16 = document.getElementById('vizSingular16');
                var spinner =new Spinner(opts).spin(targetSingular16);


                var targetSingular17 = document.getElementById('vizSingular17');
                var spinner =new Spinner(opts).spin(targetSingular17);


                var targetSingular18 = document.getElementById('vizSingular18');
                var spinner =new Spinner(opts).spin(targetSingular18);


                var targetSingular19 = document.getElementById('vizSingular19');
                var spinner =new Spinner(opts).spin(targetSingular19);


                var targetSingular20 = document.getElementById('vizSingular20');
                var spinner =new Spinner(opts).spin(targetSingular20);


                var targetSingular21 = document.getElementById('vizSingular21');
                var spinner =new Spinner(opts).spin(targetSingular21);


                var targetSingular22 = document.getElementById('vizSingular22');
                var spinner =new Spinner(opts).spin(targetSingular22);


                var targetSingular23 = document.getElementById('vizSingular23');
                var spinner =new Spinner(opts).spin(targetSingular23);


                var targetSingular24 = document.getElementById('vizSingular24');
                var spinner =new Spinner(opts).spin(targetSingular24);


                var targetSingular25 = document.getElementById('vizSingular25');
                var spinner =new Spinner(opts).spin(targetSingular25);


                var targetSingular26 = document.getElementById('vizSingular26');
                var spinner =new Spinner(opts).spin(targetSingular26);


                var targetSingular27 = document.getElementById('vizSingular27');
                var spinner =new Spinner(opts).spin(targetSingular27);


                var targetSingular28 = document.getElementById('vizSingular28');
                var spinner =new Spinner(opts).spin(targetSingular28);


                var targetSingular29 = document.getElementById('vizSingular29');
                var spinner =new Spinner(opts).spin(targetSingular29);


                var targetSingular30 = document.getElementById('vizSingular30');
                var spinner =new Spinner(opts).spin(targetSingular30);


                var targetSingular31 = document.getElementById('vizSingular31');
                var spinner =new Spinner(opts).spin(targetSingular31);


                var targetSingular32 = document.getElementById('vizSingular32');
                var spinner =new Spinner(opts).spin(targetSingular32);


                var targetSingular33 = document.getElementById('vizSingular33');
                var spinner =new Spinner(opts).spin(targetSingular33);


                var targetSingular34 = document.getElementById('vizSingular34');
                var spinner =new Spinner(opts).spin(targetSingular34);


                var targetSingular35 = document.getElementById('vizSingular35');
                var spinner =new Spinner(opts).spin(targetSingular35);


                var targetSingular36 = document.getElementById('vizSingular36');
                var spinner =new Spinner(opts).spin(targetSingular36);


                var targetSingular37 = document.getElementById('vizSingular37');
                var spinner =new Spinner(opts).spin(targetSingular37);


                var targetSingular38 = document.getElementById('vizSingular38');
                var spinner =new Spinner(opts).spin(targetSingular38);


                var targetSingular39 = document.getElementById('vizSingular39');
                var spinner =new Spinner(opts).spin(targetSingular39);


                var targetSingular40 = document.getElementById('vizSingular40');
                var spinner =new Spinner(opts).spin(targetSingular40);


                var targetSingular41 = document.getElementById('vizSingular41');
                var spinner =new Spinner(opts).spin(targetSingular41);


                var targetSingular42 = document.getElementById('vizSingular42');
                var spinner =new Spinner(opts).spin(targetSingular42);


                var targetSingular43 = document.getElementById('vizSingular43');
                var spinner =new Spinner(opts).spin(targetSingular43);


                var targetSingular44 = document.getElementById('vizSingular44');
                var spinner =new Spinner(opts).spin(targetSingular44);


                var targetSingular45 = document.getElementById('vizSingular45');
                var spinner =new Spinner(opts).spin(targetSingular45);


                var targetSingular46 = document.getElementById('vizSingular46');
                var spinner =new Spinner(opts).spin(targetSingular46);



                var targetSingular47 = document.getElementById('vizSingular47');
                var spinner =new Spinner(opts).spin(targetSingular47);


                var targetSingular48 = document.getElementById('vizSingular48');
                var spinner =new Spinner(opts).spin(targetSingular48);


                var targetSingular49 = document.getElementById('vizSingular49');
                var spinner =new Spinner(opts).spin(targetSingular49);


                var targetSingular50 = document.getElementById('vizSingular50');
                var spinner =new Spinner(opts).spin(targetSingular50);


                var targetSingular51 = document.getElementById('vizSingular51');
                var spinner =new Spinner(opts).spin(targetSingular51);


                var targetSingular52 = document.getElementById('vizSingular52');
                var spinner =new Spinner(opts).spin(targetSingular52);


                var targetSingular53 = document.getElementById('vizSingular53');
                var spinner =new Spinner(opts).spin(targetSingular53);


                var targetSingular54 = document.getElementById('vizSingular54');
                var spinner =new Spinner(opts).spin(targetSingular54);


                var targetSingular55 = document.getElementById('vizSingular55');
                var spinner =new Spinner(opts).spin(targetSingular55);


                var targetSingular56 = document.getElementById('vizSingular56');
                var spinner =new Spinner(opts).spin(targetSingular56);


                var targetSingular57 = document.getElementById('vizSingular57');
                var spinner =new Spinner(opts).spin(targetSingular57);


                var targetSingular58 = document.getElementById('vizSingular58');
                var spinner =new Spinner(opts).spin(targetSingular58);


                var targetSingular59 = document.getElementById('vizSingular59');
                var spinner =new Spinner(opts).spin(targetSingular59);



                var targetSingular60 = document.getElementById('vizSingular60');
                var spinner =new Spinner(opts).spin(targetSingular60);


                var targetSingular61 = document.getElementById('vizSingular61');
                var spinner =new Spinner(opts).spin(targetSingular61);


                var targetSingular62 = document.getElementById('vizSingular62');
                var spinner =new Spinner(opts).spin(targetSingular62);



                var targetSingular63 = document.getElementById('vizSingular63');
                var spinner =new Spinner(opts).spin(targetSingular63);


                var targetSingular64 = document.getElementById('vizSingular64');
                var spinner =new Spinner(opts).spin(targetSingular64);


                var targetSingular65 = document.getElementById('vizSingular65');
                var spinner =new Spinner(opts).stop(targetSingular65);


                var targetSingular66 = document.getElementById('vizSingular66');
                var spinner =new Spinner(opts).spin(targetSingular66);


                var targetSingular67 = document.getElementById('vizSingular67');
                var spinner =new Spinner(opts).spin(targetSingular67);


                var targetSingular68 = document.getElementById('vizSingular68');
                var spinner =new Spinner(opts).spin(targetSingular68);


                var targetSingular69 = document.getElementById('vizSingular69');
                var spinner =new Spinner(opts).spin(targetSingular69);


                var targetSingular70 = document.getElementById('vizSingular70');
                var spinner =new Spinner(opts).spin(targetSingular70);


                var targetSingular71 = document.getElementById('vizSingular71');
                var spinner =new Spinner(opts).spin(targetSingular71);


                var targetSingular72 = document.getElementById('vizSingular72');
                var spinner =new Spinner(opts).spin(targetSingular72);


                var targetSingular73 = document.getElementById('vizSingular73');
                var spinner =new Spinner(opts).spin(targetSingular73);


                var targetSingular74 = document.getElementById('vizSingular74');
                var spinner =new Spinner(opts).spin(targetSingular74);


                var targetSingular75 = document.getElementById('vizSingular75');
                var spinner =new Spinner(opts).spin(targetSingular75);


                var targetSingular76 = document.getElementById('vizSingular76');
                var spinner =new Spinner(opts).spin(targetSingular76);


                var targetSingular77 = document.getElementById('vizSingular77');
                var spinner =new Spinner(opts).spin(targetSingular77);


                var targetSingular78 = document.getElementById('vizSingular78');
                var spinner =new Spinner(opts).spin(targetSingular78);


                var targetSingular79 = document.getElementById('vizSingular79');
                var spinner =new Spinner(opts).spin(targetSingular79);


                var targetSingular80 = document.getElementById('vizSingular80');
                var spinner =new Spinner(opts).spin(targetSingular80);


                var targetSingular81 = document.getElementById('vizSingular81');
                var spinner =new Spinner(opts).spin(targetSingular81);


                var targetSingular82 = document.getElementById('vizSingular82');
                var spinner =new Spinner(opts).spin(targetSingular82);


                var targetSingular83 = document.getElementById('vizSingular83');
                var spinner =new Spinner(opts).spin(targetSingular83);


                var targetSingular84 = document.getElementById('vizSingular84');
                var spinner =new Spinner(opts).spin(targetSingular84);


                var targetSingular85 = document.getElementById('vizSingular85');
                var spinner =new Spinner(opts).spin(targetSingular85);


                var targetSingular86 = document.getElementById('vizSingular86');
                var spinner =new Spinner(opts).spin(targetSingular86);


                var targetSingular87 = document.getElementById('vizSingular87');
                var spinner =new Spinner(opts).spin(targetSingular87);


                var targetSingular88 = document.getElementById('vizSingular88');
                var spinner =new Spinner(opts).spin(targetSingular88);


                var targetSingular89 = document.getElementById('vizSingular89');
                var spinner =new Spinner(opts).spin(targetSingular89);


                var targetSingular90 = document.getElementById('vizSingular90');
                var spinner =new Spinner(opts).spin(targetSingular90);


                var targetSingular91 = document.getElementById('vizSingular91');
                var spinner =new Spinner(opts).spin(targetSingular91);


                var targetSingular92 = document.getElementById('vizSingular92');
                var spinner =new Spinner(opts).spin(targetSingular92);


                var targetSingular93 = document.getElementById('vizSingular93');
                var spinner =new Spinner(opts).spin(targetSingular93);


                var targetSingular94 = document.getElementById('vizSingular94');
                var spinner =new Spinner(opts).spin(targetSingular94);


                var targetSingular95 = document.getElementById('vizSingular95');
                var spinner =new Spinner(opts).spin(targetSingular95);


                var targetSingular96 = document.getElementById('vizSingular96');
                var spinner =new Spinner(opts).spin(targetSingular96);



                var targetSingular97 = document.getElementById('vizSingular97');
                var spinner =new Spinner(opts).spin(targetSingular97);


                var targetSingular98 = document.getElementById('vizSingular98');
                var spinner =new Spinner(opts).spin(targetSingular98);


                var targetSingular99 = document.getElementById('vizSingular99');
                var spinner =new Spinner(opts).spin(targetSingular99);


                var targetSingular100 = document.getElementById('vizSingular100');
                var spinner =new Spinner(opts).spin(targetSingular100);


                //  Spinner ends.


         //    var spinner = new Spinner().spin();
         //    target.appendChild(spinner.el);


        let self = this;
        let recordCount = 0;

        let session = this._driver.session();
        session
            .run(this._query, {limit: 30})
            .subscribe({
                onNext: function (record) {
                    recordCount++;

                    console.log("CLASS NAME");
                    console.log(record.constructor.name);
                    console.log(record);

                    record.forEach(function(v, k, r) {
                    console.log("Constructor:");
                    console.log(v.constructor.name);
                    if (v.constructor.name === "Node") {
                        let node = self.buildNodeVisObject(v);

                        try {
                            self._addNode(node);
                        } catch(e) {
                            console.log(e);
                        }

                    }
                    else if (v.constructor.name === "Relationship") {

                        let edge = self.buildEdgeVisObject(v);

                        try {
                            self._addEdge(edge);
                        } catch(e) {
                            console.log(e);
                        }

                    }
                    else if (v.constructor.name === "Path") {
                        console.log("PATH");
                        console.log(v);
                        let n1 = self.buildNodeVisObject(v.start);
                        let n2 = self.buildNodeVisObject(v.end);
                        
                        self._addNode(n1);
                        self._addNode(n2);

                        v.segments.forEach((obj) => {
                            
                            self._addNode(self.buildNodeVisObject(obj.start));
                            self._addNode(self.buildNodeVisObject(obj.end))
                            self._addEdge(self.buildEdgeVisObject(obj.relationship))
                        });

                    }
                    else if (v.constructor.name === "Array") {
                        v.forEach(function(obj) {
                            console.log("Array element constructor:");
                            console.log(obj.constructor.name);
                            if (obj.constructor.name === "Node") {
                                let node = self.buildNodeVisObject(obj);

                                try {
                                    self._addNode(node);
                                } catch(e) {
                                    console.log(e);
                                }
                            }
                            else if (obj.constructor.name === "Relationship") {
                                let edge = self.buildEdgeVisObject(obj);

                                try {
                                    self._addEdge(edge);
                                } catch(e) {
                                    console.log(e);
                                }
                            }
                        });
                    }

                })
                },
                onCompleted: function () {
                    session.close();
                   
            
                //target.appendChild(spinner.el);


                  
                  let options = {

                  //  autoResize: true,
                   // height: '600',
                  //  width: '100%',
                  
                    nodes: {
                        shape: 'dot',
                        font: {
                            size: 26,
                            strokeWidth: 7
                        },
                        scaling: {
                            label: {
                                enabled: true
                            }
                        }
                    },

                    interaction: {
                        hover: true,
                        keyboard: {
                            enabled: true,
                            // bindToWindow: false
                            bindToWindow: true
                        },
                        navigationButtons: true,
                        tooltipDelay: 1000000,
                        hideEdgesOnDrag: true,
                        // zoomView: false
                        zoomView: true
                    },

                    edges: {
                        arrows: {
                            to: { enabled: self._config.arrows || false } // FIXME: handle default value
                        },
                        length: 200
                    },
                    layout: {
                        improvedLayout: false,
                        hierarchical: {
                            enabled: self._config.hierarchical || false,
                            sortMethod: self._config.hierarchical_sort_method || "hubsize"

                        }
                    },



                    // physics: { // TODO: adaptive physics settings based on size of graph rendered
                        //enabled: true,
                       // timestep: 0.5,
                        //stabilization: {
                          //  iterations: 210
                        // },
                        
                            // adaptiveTimestep: true,
                            //barnesHut: {
                                //gravitationalConstant: 50,
                                // springConstant: 0.00,
                                //springLength: 105
                            // },
                            //stabilization: {
                              //  iterations: 250,
                                //fit: true
                            //}
                        
                    // }


                    // physics: {
                    //     stabilization: {
                    //         fit: true,
                    //         updateInterval: 5,
                    //         iterations: 20
                    //     },
                    //     barnesHut: {
                    //         damping: 0.7
                    //     }
                    // }
                  };

                var container = self._container;
                self._data = {
                    "nodes": new vis.DataSet(Object.values(self._nodes)),
                    "edges": new vis.DataSet(Object.values(self._edges))

                }

                console.log(self._data.nodes);
                console.log(self._data.edges);
                
                // Create duplicate node for any self reference relationships
                // NOTE: Is this only useful for data model type data
                // self._data.edges = self._data.edges.map( 
                //     function (item) {
                //          if (item.from == item.to) {
                //             var newNode = self._data.nodes.get(item.from)
                //             delete newNode.id;
                //             var newNodeIds = self._data.nodes.add(newNode);
                //             console.log("Adding new node and changing self-ref to node: " + item.to);
                //             item.to = newNodeIds[0];
                //          }
                //          return item;
                //     }
                // );
                
                self._network = new vis.Network(container, self._data, options);
                console.log("completed");
                setTimeout(() => { self._network.stopSimulation(); }, 10000);

                //spinner
                var target = document.getElementById('viz');
                var spinner =new Spinner(opts).stop(target);


                //Machine-Merger spinner

                var target0 = document.getElementById('viz0');
                var spinner =new Spinner(opts).stop(target0);


                var target1 = document.getElementById('viz1');
                var spinner =new Spinner(opts).stop(target1);


                var target2 = document.getElementById('viz2');
                var spinner =new Spinner(opts).stop(target2);


                var target3 = document.getElementById('viz3');
                var spinner =new Spinner(opts).stop(target3);


                var target4 = document.getElementById('viz4');
                var spinner =new Spinner(opts).stop(target4);



                var target5 = document.getElementById('viz5');
                var spinner =new Spinner(opts).stop(target5);


                var target01 = document.getElementById('viz01');
                var spinner =new Spinner(opts).stop(target01);


                var target11 = document.getElementById('viz11');
                var spinner =new Spinner(opts).stop(target11);


                var target21 = document.getElementById('viz21');
                var spinner =new Spinner(opts).stop(target21);


                var target31 = document.getElementById('viz31');
                var spinner =new Spinner(opts).stop(target31);


                var target41 = document.getElementById('viz41');
                var spinner =new Spinner(opts).stop(target41);


                var target51 = document.getElementById('viz51');
                var spinner =new Spinner(opts).stop(target51);


                var targetSingle = document.getElementById('vizSingle');
                var spinner =new Spinner(opts).stop(targetSingle);


                var targetSingle1 = document.getElementById('vizSingle1');
                var spinner =new Spinner(opts).stop(targetSingle1);


                //-----------  Machine-merger spinner ends  -----------

                //============   Duplicity spinner   ================


                var targetCollection = document.getElementById('vizCollection');
                var spinner =new Spinner(opts).stop(targetCollection);


                var targetExtractNetwork = document.getElementById('vizExtractNetwork');
                var spinner =new Spinner(opts).stop(targetExtractNetwork);


                var targetSingular0 = document.getElementById('vizSingular0');
                var spinner =new Spinner(opts).stop(targetSingular0);


                var targetSingular1 = document.getElementById('vizSingular1');
                var spinner =new Spinner(opts).stop(targetSingular1);


                var targetSingular2 = document.getElementById('vizSingular2');
                var spinner =new Spinner(opts).stop(targetSingular2);


                var targetSingular3 = document.getElementById('vizSingular3');
                var spinner =new Spinner(opts).stop(targetSingular3);


                var targetSingular4 = document.getElementById('vizSingular4');
                var spinner =new Spinner(opts).stop(targetSingular4);


                var targetSingular5 = document.getElementById('vizSingular5');
                var spinner =new Spinner(opts).stop(targetSingular5);


                var targetSingular6 = document.getElementById('vizSingular6');
                var spinner =new Spinner(opts).stop(targetSingular6);


                var targetSingular7 = document.getElementById('vizSingular7');
                var spinner =new Spinner(opts).stop(targetSingular7);


                var targetSingular8 = document.getElementById('vizSingular8');
                var spinner =new Spinner(opts).stop(targetSingular8);


                var targetSingular9 = document.getElementById('vizSingular9');
                var spinner =new Spinner(opts).stop(targetSingular9);



                var targetSingular10 = document.getElementById('vizSingular10');
                var spinner =new Spinner(opts).stop(targetSingular10);


                var targetSingular11 = document.getElementById('vizSingular11');
                var spinner =new Spinner(opts).stop(targetSingular11);


                var targetSingular12 = document.getElementById('vizSingular12');
                var spinner =new Spinner(opts).stop(targetSingular12);



                var targetSingular13 = document.getElementById('vizSingular13');
                var spinner =new Spinner(opts).stop(targetSingular13);


                var targetSingular14 = document.getElementById('vizSingular14');
                var spinner =new Spinner(opts).stop(targetSingular14);


                var targetSingular15 = document.getElementById('vizSingular15');
                var spinner =new Spinner(opts).stop(targetSingular15);


                var targetSingular16 = document.getElementById('vizSingular16');
                var spinner =new Spinner(opts).stop(targetSingular16);


                var targetSingular17 = document.getElementById('vizSingular17');
                var spinner =new Spinner(opts).stop(targetSingular17);


                var targetSingular18 = document.getElementById('vizSingular18');
                var spinner =new Spinner(opts).stop(targetSingular18);


                var targetSingular19 = document.getElementById('vizSingular19');
                var spinner =new Spinner(opts).stop(targetSingular19);


                var targetSingular20 = document.getElementById('vizSingular20');
                var spinner =new Spinner(opts).stop(targetSingular20);


                var targetSingular21 = document.getElementById('vizSingular21');
                var spinner =new Spinner(opts).stop(targetSingular21);


                var targetSingular22 = document.getElementById('vizSingular22');
                var spinner =new Spinner(opts).stop(targetSingular22);


                var targetSingular23 = document.getElementById('vizSingular23');
                var spinner =new Spinner(opts).stop(targetSingular23);


                var targetSingular24 = document.getElementById('vizSingular24');
                var spinner =new Spinner(opts).stop(targetSingular24);


                var targetSingular25 = document.getElementById('vizSingular25');
                var spinner =new Spinner(opts).stop(targetSingular25);


                var targetSingular26 = document.getElementById('vizSingular26');
                var spinner =new Spinner(opts).stop(targetSingular26);


                var targetSingular27 = document.getElementById('vizSingular27');
                var spinner =new Spinner(opts).stop(targetSingular27);


                var targetSingular28 = document.getElementById('vizSingular28');
                var spinner =new Spinner(opts).stop(targetSingular28);


                var targetSingular29 = document.getElementById('vizSingular29');
                var spinner =new Spinner(opts).stop(targetSingular29);


                var targetSingular30 = document.getElementById('vizSingular30');
                var spinner =new Spinner(opts).stop(targetSingular30);


                var targetSingular31 = document.getElementById('vizSingular31');
                var spinner =new Spinner(opts).stop(targetSingular31);


                var targetSingular32 = document.getElementById('vizSingular32');
                var spinner =new Spinner(opts).stop(targetSingular32);


                var targetSingular33 = document.getElementById('vizSingular33');
                var spinner =new Spinner(opts).stop(targetSingular33);


                var targetSingular34 = document.getElementById('vizSingular34');
                var spinner =new Spinner(opts).stop(targetSingular34);


                var targetSingular35 = document.getElementById('vizSingular35');
                var spinner =new Spinner(opts).stop(targetSingular35);


                var targetSingular36 = document.getElementById('vizSingular36');
                var spinner =new Spinner(opts).stop(targetSingular36);


                var targetSingular37 = document.getElementById('vizSingular37');
                var spinner =new Spinner(opts).stop(targetSingular37);


                var targetSingular38 = document.getElementById('vizSingular38');
                var spinner =new Spinner(opts).stop(targetSingular38);


                var targetSingular39 = document.getElementById('vizSingular39');
                var spinner =new Spinner(opts).stop(targetSingular39);


                var targetSingular40 = document.getElementById('vizSingular40');
                var spinner =new Spinner(opts).stop(targetSingular40);


                var targetSingular41 = document.getElementById('vizSingular41');
                var spinner =new Spinner(opts).stop(targetSingular41);


                var targetSingular42 = document.getElementById('vizSingular42');
                var spinner =new Spinner(opts).stop(targetSingular42);


                var targetSingular43 = document.getElementById('vizSingular43');
                var spinner =new Spinner(opts).stop(targetSingular43);


                var targetSingular44 = document.getElementById('vizSingular44');
                var spinner =new Spinner(opts).stop(targetSingular44);


                var targetSingular45 = document.getElementById('vizSingular45');
                var spinner =new Spinner(opts).stop(targetSingular45);


                var targetSingular46 = document.getElementById('vizSingular46');
                var spinner =new Spinner(opts).stop(targetSingular46);



                var targetSingular47 = document.getElementById('vizSingular47');
                var spinner =new Spinner(opts).stop(targetSingular47);


                var targetSingular48 = document.getElementById('vizSingular48');
                var spinner =new Spinner(opts).stop(targetSingular48);


                var targetSingular49 = document.getElementById('vizSingular49');
                var spinner =new Spinner(opts).stop(targetSingular49);


                var targetSingular50 = document.getElementById('vizSingular50');
                var spinner =new Spinner(opts).stop(targetSingular50);


                var targetSingular51 = document.getElementById('vizSingular51');
                var spinner =new Spinner(opts).stop(targetSingular51);


                var targetSingular52 = document.getElementById('vizSingular52');
                var spinner =new Spinner(opts).stop(targetSingular52);


                var targetSingular53 = document.getElementById('vizSingular53');
                var spinner =new Spinner(opts).stop(targetSingular53);


                var targetSingular54 = document.getElementById('vizSingular54');
                var spinner =new Spinner(opts).stop(targetSingular54);


                var targetSingular55 = document.getElementById('vizSingular55');
                var spinner =new Spinner(opts).stop(targetSingular55);


                var targetSingular56 = document.getElementById('vizSingular56');
                var spinner =new Spinner(opts).stop(targetSingular56);


                var targetSingular57 = document.getElementById('vizSingular57');
                var spinner =new Spinner(opts).stop(targetSingular57);


                var targetSingular58 = document.getElementById('vizSingular58');
                var spinner =new Spinner(opts).stop(targetSingular58);


                var targetSingular59 = document.getElementById('vizSingular59');
                var spinner =new Spinner(opts).stop(targetSingular59);









                var targetSingular60 = document.getElementById('vizSingular60');
                var spinner =new Spinner(opts).stop(targetSingular60);


                var targetSingular61 = document.getElementById('vizSingular61');
                var spinner =new Spinner(opts).stop(targetSingular61);


                var targetSingular62 = document.getElementById('vizSingular62');
                var spinner =new Spinner(opts).stop(targetSingular62);



                var targetSingular63 = document.getElementById('vizSingular63');
                var spinner =new Spinner(opts).stop(targetSingular63);


                var targetSingular64 = document.getElementById('vizSingular64');
                var spinner =new Spinner(opts).stop(targetSingular64);


                var targetSingular65 = document.getElementById('vizSingular65');
                var spinner =new Spinner(opts).stop(targetSingular65);


                var targetSingular66 = document.getElementById('vizSingular66');
                var spinner =new Spinner(opts).stop(targetSingular66);


                var targetSingular67 = document.getElementById('vizSingular67');
                var spinner =new Spinner(opts).stop(targetSingular67);


                var targetSingular68 = document.getElementById('vizSingular68');
                var spinner =new Spinner(opts).stop(targetSingular68);


                var targetSingular69 = document.getElementById('vizSingular69');
                var spinner =new Spinner(opts).stop(targetSingular69);


                var targetSingular70 = document.getElementById('vizSingular70');
                var spinner =new Spinner(opts).stop(targetSingular70);


                var targetSingular71 = document.getElementById('vizSingular71');
                var spinner =new Spinner(opts).stop(targetSingular71);


                var targetSingular72 = document.getElementById('vizSingular72');
                var spinner =new Spinner(opts).stop(targetSingular72);


                var targetSingular73 = document.getElementById('vizSingular73');
                var spinner =new Spinner(opts).stop(targetSingular73);


                var targetSingular74 = document.getElementById('vizSingular74');
                var spinner =new Spinner(opts).stop(targetSingular74);


                var targetSingular75 = document.getElementById('vizSingular75');
                var spinner =new Spinner(opts).stop(targetSingular75);


                var targetSingular76 = document.getElementById('vizSingular76');
                var spinner =new Spinner(opts).stop(targetSingular76);


                var targetSingular77 = document.getElementById('vizSingular77');
                var spinner =new Spinner(opts).stop(targetSingular77);


                var targetSingular78 = document.getElementById('vizSingular78');
                var spinner =new Spinner(opts).stop(targetSingular78);


                var targetSingular79 = document.getElementById('vizSingular79');
                var spinner =new Spinner(opts).stop(targetSingular79);


                var targetSingular80 = document.getElementById('vizSingular80');
                var spinner =new Spinner(opts).stop(targetSingular80);


                var targetSingular81 = document.getElementById('vizSingular81');
                var spinner =new Spinner(opts).stop(targetSingular81);


                var targetSingular82 = document.getElementById('vizSingular82');
                var spinner =new Spinner(opts).stop(targetSingular82);


                var targetSingular83 = document.getElementById('vizSingular83');
                var spinner =new Spinner(opts).stop(targetSingular83);


                var targetSingular84 = document.getElementById('vizSingular84');
                var spinner =new Spinner(opts).stop(targetSingular84);


                var targetSingular85 = document.getElementById('vizSingular85');
                var spinner =new Spinner(opts).stop(targetSingular85);


                var targetSingular86 = document.getElementById('vizSingular86');
                var spinner =new Spinner(opts).stop(targetSingular86);


                var targetSingular87 = document.getElementById('vizSingular87');
                var spinner =new Spinner(opts).stop(targetSingular87);


                var targetSingular88 = document.getElementById('vizSingular88');
                var spinner =new Spinner(opts).stop(targetSingular88);


                var targetSingular89 = document.getElementById('vizSingular89');
                var spinner =new Spinner(opts).stop(targetSingular89);


                var targetSingular90 = document.getElementById('vizSingular90');
                var spinner =new Spinner(opts).stop(targetSingular90);


                var targetSingular91 = document.getElementById('vizSingular91');
                var spinner =new Spinner(opts).stop(targetSingular91);


                var targetSingular92 = document.getElementById('vizSingular92');
                var spinner =new Spinner(opts).stop(targetSingular92);


                var targetSingular93 = document.getElementById('vizSingular93');
                var spinner =new Spinner(opts).stop(targetSingular93);


                var targetSingular94 = document.getElementById('vizSingular94');
                var spinner =new Spinner(opts).stop(targetSingular94);


                var targetSingular95 = document.getElementById('vizSingular95');
                var spinner =new Spinner(opts).stop(targetSingular95);


                var targetSingular96 = document.getElementById('vizSingular96');
                var spinner =new Spinner(opts).stop(targetSingular96);



                var targetSingular97 = document.getElementById('vizSingular97');
                var spinner =new Spinner(opts).stop(targetSingular97);


                var targetSingular98 = document.getElementById('vizSingular98');
                var spinner =new Spinner(opts).stop(targetSingular98);


                var targetSingular99 = document.getElementById('vizSingular99');
                var spinner =new Spinner(opts).stop(targetSingular99);


                var targetSingular100 = document.getElementById('vizSingular100');
                var spinner =new Spinner(opts).stop(targetSingular100);




                //================  Duplicity spinner ends  ===================


                // --------------------  spinner ends  -----------------------

                self._events.generateEvent(CompletionEvent, {record_count: recordCount});

                },
                onError: function (error) {
                  console.log(error);
                }

            })
        };

    /**
     * Clear the data for the visualization
     */
    clearNetwork() {
        this._nodes = {}
        this._edges = {};
        this._network.setData([]);
    }

// Zoom In and Zoom Out functions.

 zoomin() {
    var myImg = document.getElementById("viz");
    var currWidth = myImg.clientWidth;
    if (currWidth == 2500) return false;
    else {
      myImg.style.width = (currWidth + 100) + "px";
    }
  }
  
  zoomout() {
    var myImg = document.getElementById("viz");
    var currWidth = myImg.clientWidth;
    if (currWidth == 100) return false;
    else {
      myImg.style.width = (currWidth - 100) + "px";
    }
  }





    /**
     *
     * @param {string} eventType Event type to be handled
     * @param {callback} handler Handler to manage the event
     */
    registerOnEvent(eventType, handler) {
        this._events.register(eventType, handler);
    }


    /**
     * Reset the config object and reload data
     * @param config
     */
    reinit(config) {

    };

    /**
     * Fetch live data form the server and reload the visualization
     */
    reload() {

        this.clearNetwork();
        this.render();


    };

    /**
     * Stabilize the visuzliation
     */
    stabilize() {
        this._network.stopSimulation();
        console.log("Calling stopSimulation");
    }

    /**
     * Execute an arbitrary Cypher query and re-render the visualization
     * @param query
     */
    renderWithCypher(query) {

        //self._config.initial_cypher = query;

        this.clearNetwork();
        this._query = query;
        this.render();

    };

    // configure exports based on environment (ie Node.js or browser)
    //if (typeof exports === 'object') {
    //    module.exports = NeoVis;
    //} else {
    //    define (function () {return NeoVis;})
    //}

}

