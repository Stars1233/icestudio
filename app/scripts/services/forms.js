/* global jspreadsheet */

//---------------------------------------------------------------------------
//-- Forms managment
//---------------------------------------------------------------------------
'use strict';

angular
  .module('icestudio')
  .service(
    'forms',
    function (gettextCatalog, common, profile, blocks, utils, nodeFs) {
      //---------------------------------------------------------
      //-- LABELFIELD. It represents a static text label in the Form
      //---------------------------------------------------------
      //-- This is how this field is rendered in the Form
      //
      //    Label text
      //    +-----------------+
      //----------------------------------------------------------
      class LabelField {
        //-----------------------------------------------------------------------
        //-- Input parameters:
        //--   * msg: The label text to be displayed
        //--   * formId: Form identification number
        //-----------------------------------------------------------------------
        constructor(msg, formId) {
          //-- Properties
          this.msg = msg;
          this.formId = formId;

          //-- Html template for rendering the label
          //-- The parameters are:
          //--  %TEXT% : Label text
          //--  %ID% : Form identification number
          this.htmlTemplate = `
            <p id="label%ID%" class="form-label"> %TEXT% </p>
          `;
        }

        //---------------------------------------------------------
        //-- Return a string with the HTML code for this field
        //---------------------------------------------------------
        html() {
          //-- Insert the parameters in the html template
          let html = this.htmlTemplate.replace('%TEXT%', this.msg);
          html = html.replace('%ID%', this.formId);

          return html;
        }

        //---------------------------------------------
        //-- Read the Field value (returns the label text)
        //---------------------------------------------
        read() {
          //-- Read the text content from the DOM
          let value = $(`#label${this.formId}`).text();
          return value;
        }
      }

      //---------------------------------------------------------
      //-- TEXTFIELD. It represents a Form Input text field
      //---------------------------------------------------------
      //-- This is how this field is rendered in the Form
      //
      //    text message
      //    +-----------------+
      //    | Input text      |
      //    +-----------------+
      //----------------------------------------------------------
      class TextField {
        //-----------------------------------------------------------------------
        //-- Input parameters:
        //--   * msg: Text place above the input box
        //--   * value: Default value
        //--   * formId: Form identification number
        //-----------------------------------------------------------------------
        constructor(msg, value, formId) {
          //-- Properties
          this.msg = msg;
          this.value = value;
          this.formId = formId;
          this.onChangeCallback = null;

          //-- Html template for building the text field
          //-- The parameters are:
          //--  %TEXT% : Text place above the input box
          //--  %ID% : Form identification number
          //--  %VALUE%: Default text value
          this.htmlTemplate = `
            <p> %TEXT% </p>
            <input class="ajs-input"
                  type="text"
                  id="form%ID%"
                  value="%VALUE%"
                  autocomplete="off"/>
          `;
        }

        //---------------------------------------------------------
        //-- Return a string whith the HTML code for this field
        //---------------------------------------------------------
        html() {
          //-- Generate the HTML code

          //-- Insert the parameters in the html code template
          let html = this.htmlTemplate.replace('%TEXT%', this.msg);
          html = html.replace('%VALUE%', this.value);
          html = html.replace('%ID%', this.formId);

          return html;
        }

        //---------------------------------------------
        //-- Read the Field value
        //---------------------------------------------
        read() {
          //-- Read the value from the DOM
          let value = $(`#form${this.formId}`).val();

          return value;
        }

        //---------------------------------------------
        //-- Write a value to the Field
        //---------------------------------------------
        write(value) {
          //-- Write the value to the DOM
          $(`#form${this.formId}`).val(value);
        }

        //------------------------------------------------
        onChange(callback) {
          this.onChangeCallback = callback;
        }

        init() {
          const selector = `#form${this.formId}`;
          if (this.onChangeCallback && $(selector).length) {
            $(selector).on('input', (e) => {
              this.onChangeCallback($(e.target).val());
            });
          }
        }
      }

      //-------------------------------------------------------------------------
      //--- CHECKBOX FIELD. Input checkbox field
      //-------------------------------------------------------------------------
      //-- This is how it is rendered in the Form
      //
      //     [ ] Label
      //
      //-------------------------------------------------------------------------
      class CheckboxField {
        //-----------------------------------------------------------------------
        //-- Input parameters:
        //--   * Label: Text place to the right of the checkbox
        //--   * value: Default value
        //--   * formId: Form identification number
        //--   * disabled: If the checkbox is active or not
        //-----------------------------------------------------------------------
        constructor(label, value, formId, disabled = false) {
          //-- Properties
          this.label = label;
          this.value = value;
          this.formId = formId;
          this.disabled = disabled;

          //-- Html template for building the checkbox field
          //-- The parameters are:
          //--  %LABEL% : Text place to the right of the checkbox
          //--  %ID% : Form identification number
          //--  %VALUE%: Default value
          this.htmlTemplate = `
        <div class="checkbox">
          <label>
            <input type="checkbox" %VALUE% id="form%ID%" %DISABLED%/>
            %LABEL%
          </label>
        </div>
      `;
        }

        //---------------------------------------------------------
        //-- Return a string whith the HTML code for this field
        //---------------------------------------------------------
        html() {
          //-- Create the disabled attribute
          let disabled = this.disabled ? 'disabled' : '';

          //-- Insert the parameters in the html code template
          let html = this.htmlTemplate.replace(
            '%VALUE%',
            this.value ? 'checked' : ''
          );

          html = html.replace('%ID%', this.formId);
          html = html.replace('%LABEL%', this.label);
          html = html.replace('%DISABLED%', disabled);

          return html;
        }

        //---------------------------------------------
        //-- Read the Field value
        //---------------------------------------------
        read() {
          //-- Read the value from the form i
          let value = $($('#form' + this.formId).prop('checked'));
          value = value[0] || false;

          return value;
        }
      }

      //-------------------------------------------------------------------------
      //--- COLOR FIELD. Input color dropdown field
      //-------------------------------------------------------------------------
      //-- This is how it is rendered in the Form
      //
      //      Text message
      //      +-----------------+
      //      | o Color       v |
      //      +-----------------+
      //
      //-------------------------------------------------------------------------

      class ColorField {
        //-----------------------------------------------------------------------
        //-- Create the html code for an input color dropdown field
        //-- INPUTS:
        //--   * msg: Text place above the color input box
        //--   * color: Color value (String)
        //--   * colorName: Color name (String)
        //--
        //-- Returns:
        //--   -A string with the HTML code for that Field
        //-----------------------------------------------------------------------
        constructor(msg, color) {
          //-- Properties
          this.msg = msg;
          this.color = color;
          this.colorName = this.getColorName(color);

          //-- Html template for building the color selector field
          //-- The parameters are:
          //--  %TEXT% : Text place to the right of the checkbox
          //--  %COLOR% : Color (in english)
          //--  %COLOR_NAME%: Color (translated)
          this.htmlTemplate = `
        <div class="form-group">
          <label style ="font-weight:normal"> %TEXT% </label>
          <div class="lb-color--dropdown">
            <div class="lb-dropdown-title">

              <!-- The current color is the one found in spec.color -->
              <span class="lb-selected-color color-%COLOR%"
                data-color="%COLOR%"
                data-name="%COLOR_NAME%">
              </span>
              %COLOR_NAME%
              <span class="lb-dropdown-icon"></span>
            </div>

            <div class="lb-dropdown-menu">

            <div class="lb-dropdown-option"
              data-color="indianred"
              data-name="${this.getColorName('indianred')}">
                <span class="lb-option-color color-indianred">
                </span>
                ${this.getColorName('indianred')}
            </div>

            <div class="lb-dropdown-option"
              data-color="red"
              data-name="${this.getColorName('red')}">
                <span class="lb-option-color color-red">
                </span>
                ${this.getColorName('red')}
            </div>

            <div class="lb-dropdown-option"
              data-color="deeppink"
              data-name="${this.getColorName('deeppink')}">
                <span class="lb-option-color color-deeppink">
                </span>
                ${this.getColorName('deeppink')}
            </div>

            <div class="lb-dropdown-option"
              data-color="mediumvioletred"
              data-name="${this.getColorName('mediumvioletred')}">
                <span class="lb-option-color color-mediumvioletred">
                </span>
                ${this.getColorName('mediumvioletred')}
            </div>

            <div class="lb-dropdown-option"
              data-color="coral"
              data-name="${this.getColorName('coral')}">
                <span class="lb-option-color color-coral"></span>
                ${this.getColorName('coral')}
            </div>

            <div class="lb-dropdown-option"
              data-color="orangered"
              data-name="${this.getColorName('orangered')}">
                <span class="lb-option-color color-orangered"></span>
                ${this.getColorName('orangered')}
            </div>

            <div class="lb-dropdown-option"
              data-color="darkorange"
              data-name="${this.getColorName('darkorange')}">
                <span class="lb-option-color color-darkorange"></span>
                ${this.getColorName('darkorange')}
            </div>

            <div class="lb-dropdown-option"
              data-color="gold"
              data-name="${this.getColorName('gold')}">
                <span class="lb-option-color color-gold"></span>
                ${this.getColorName('gold')}
            </div>

            <div class="lb-dropdown-option"
              data-color="yellow"
              data-name="${this.getColorName('yellow')}">
                <span class="lb-option-color color-yellow"></span>
                ${this.getColorName('yellow')}
            </div>

            <div class="lb-dropdown-option"
              data-color="fuchsia"
              data-name=" ${this.getColorName('fuchsia')}">
                <span class="lb-option-color color-fuchsia"></span>
                ${this.getColorName('fuchsia')}
            </div>

            <div class="lb-dropdown-option"
              data-color="slateblue"
              data-name="${this.getColorName('slateblue')}">
                <span class="lb-option-color color-slateblue"></span>
                ${this.getColorName('slateblue')}
            </div>
            <div class="lb-dropdown-option"
              data-color="greenyellow"
              data-name="${this.getColorName('greenyellow')}">
                <span class="lb-option-color color-greenyellow"></span>
                ${this.getColorName('greenyellow')}
            </div>

            <div class="lb-dropdown-option"
              data-color="springgreen"
              data-name="${this.getColorName('springgreen')}">
                <span class="lb-option-color color-springgreen"></span>
                ${this.getColorName('springgreen')}
            </div>

            <div class="lb-dropdown-option"
              data-color="darkgreen"
              data-name="${this.getColorName('darkgreen')}">
                <span class="lb-option-color color-darkgreen"></span>
                ${this.getColorName('darkgreen')}
            </div>

            <div class="lb-dropdown-option"
              data-color="olivedrab"
              data-name="${this.getColorName('olivedrab')}">
                <span class="lb-option-color color-olivedrab">
                </span>
                ${this.getColorName('olivedrab')}
            </div>

            <div class="lb-dropdown-option"
              data-color="lightseagreen"
              data-name="${this.getColorName('lightseagreen')}">
                <span class="lb-option-color color-lightseagreen"></span>
                ${this.getColorName('lightseagreen')}
            </div>

            <div class="lb-dropdown-option"
              data-color="turquoise"
              data-name="${this.getColorName('turquioise')}">
                <span class="lb-option-color color-turquoise"></span>
                ${this.getColorName('turquoise')}
            </div>

            <div class="lb-dropdown-option"
              data-color="steelblue"
              data-name="${this.getColorName('steelblue')}">
                <span class="lb-option-color color-steelblue"></span>
                ${this.getColorName('steelblue')}
            </div>

            <div class="lb-dropdown-option"
              data-color="deepskyblue"
              data-name="${this.getColorName('deepskyblue')}">
                <span class="lb-option-color color-deepskyblue"></span>
                ${this.getColorName('deepskyblue')}
            </div>

            <div class="lb-dropdown-option"
              data-color="royalblue"
              data-name="${this.getColorName('royalblue')}">
                <span class="lb-option-color color-royalblue"></span>
                ${this.getColorName('royalblue')}
            </div>

            <div class="lb-dropdown-option"
              data-color="navy"
              data-name="${this.getColorName('navy')}">
                <span class="lb-option-color color-navy"></span>
                ${this.getColorName('navy')}
            </div>

            <div class="lb-dropdown-option"
              data-color="lightgray"
              data-name="${this.getColorName('lightgray')}">
                <span class="lb-option-color color-lightgray"></span>
                ${this.getColorName('lightgray')}
            </div>

            </div>
          </div>
        </div>
      `;
        }

        //-------------------------------------------------------------------
        //-- Get the color name (translated into the current language)
        //--
        //-- INPUT:
        //--  * color: Color value to get its name
        //-------------------------------------------------------------------
        getColorName(color) {
          switch (color) {
            case 'fuchsia':
              return gettextCatalog.getString('Fuchsia');

            case 'indianred':
              return gettextCatalog.getString('Indian Red');

            case 'red':
              return gettextCatalog.getString('Red');

            case 'deeppink':
              return gettextCatalog.getString('Deep Pink');

            case 'mediumvioletred':
              return gettextCatalog.getString('Medium Violet Red');

            case 'coral':
              return gettextCatalog.getString('Coral');

            case 'orangered':
              return gettextCatalog.getString('Orange Red');

            case 'darkorange':
              return gettextCatalog.getString('Dark Orange');

            case 'gold':
              return gettextCatalog.getString('Gold');

            case 'yellow':
              return gettextCatalog.getString('Yellow');

            case 'slateblue':
              return gettextCatalog.getString('Slate Blue');

            case 'greenyellow':
              return gettextCatalog.getString('Green Yellow');

            case 'springgreen':
              return gettextCatalog.getString('Spring Green');

            case 'darkgreen':
              return gettextCatalog.getString('Dark Green');

            case 'olivedrab':
              return gettextCatalog.getString('Olive Drab');

            case 'lightseagreen':
              return gettextCatalog.getString('Light Sea Green');

            case 'turquoise':
              return gettextCatalog.getString('Turquoise');

            case 'steelblue':
              return gettextCatalog.getString('Steel Blue');

            case 'deepskyblue':
              return gettextCatalog.getString('Deep Sky Blue');

            case 'royalblue':
              return gettextCatalog.getString('Royal Blue');

            case 'navy':
              return gettextCatalog.getString('Navy');

            case 'lightgray':
              return gettextCatalog.getString('Light Gray');
          }
        }

        //---------------------------------------------------------
        //-- Return a string whith the HTML code for this field
        //---------------------------------------------------------
        html() {
          //-- Generate the HTML code

          //-- Insert the parameters in the html code template
          let html = this.htmlTemplate.replace('%TEXT%', this.msg);

          html = html.replaceAll('%COLOR%', this.color);
          html = html.replaceAll('%COLOR_NAME%', this.colorName);

          return html;
        }

        //---------------------------------------------
        //-- Read the Field value
        //---------------------------------------------
        read() {
          //-- Read the value
          let value = $('.lb-selected-color').data('color');

          return value;
        }
      }

      //-------------------------------------------------------------------------
      //--- Input combobox field
      //-------------------------------------------------------------------------
      /*
            Label
           +-----------------+
           | Option        v |
           +-----------------+
     */
      class ComboboxField {
        //-------------------------------------------------------------------------
        //-- create the html code for a Combobox input Field
        //-- INPUTS:
        //--   * options: Array of options. Each option have the attributes:
        //--        -value
        //--        -label
        //--   * value: Default Value for the option
        //--   * selected: If this option is the default
        //--   * label: Text assigned to the option
        //--   * size: Size of the combobox
        //--
        //--  Returns:
        //--    -A string with the HTML code
        //-------------------------------------------------------------------------
        constructor(options, label, value, formId, size = null) {
          //-- Properties
          this.label = label;
          this.options = options;
          this.value = value;
          this.formId = formId;
          this.size = size === null ? 'auto' : size;

          //-- Html template for building the combobox field
          //-- The parameters are:
          //--  %VALUE% : Default value for the option
          //--  %LABEL% : Text assigned to the option
          //--  %SELECTED%: If the option is the default
          this.htmlComboboxOptionTemplate = `
        <option value="%VALUE%" %SELECTED%>
          %LABEL%
        </option>
      `;

          //--  %ID% : Form identification number
          //--  %OPTIONS%: Array of available options
          this.htmlTemplate = `
        <div class="form-group" style="width:%SIZE%">
          <label style="font-weight:normal">%LABEL%</label>
          <select class="form-control" id="form%ID%">
            %OPTIONS%
          </select>
        </div>
      `;
        }

        //----------------------------------------------------
        //-- create the html code for the option tag
        //-- INPUTS:
        //--   * value: Value for the option
        //--   * selected: If this option is de default
        //--   * label: Text assigned to the option
        //--
        //--  Returns:
        //--    -A string with the HTML code
        //----------------------------------------------------
        htmlComboboxOption(value, selected, label) {
          //-- Insert the parameters in the html TEMPLATE
          let html = this.htmlComboboxOptionTemplate.replace('%VALUE%', value);
          html = html.replace('%SELECTED%', selected);
          html = html.replace('%LABEL%', label);

          return html;
        }

        //-----------------------------------------------------------------------
        //-- Create the html code for a Combobox input Field
        //-- INPUTS:
        //--   * options: Array of options. Each option have the attributes:
        //--        -value
        //--        -label
        //--   * value: Default Value for the option
        //--   * selected: If this option is the default
        //--   * label: Text assigned to the option
        //--
        //--  Returns:
        //--    -A string with the HTML code
        //-----------------------------------------------------------------------
        html() {
          //-- Generate the HTML code

          //-- Array with the html code generated by the options
          let opts = [];

          //-- Apply to every option in the combobox
          this.options.forEach((op) => {
            //-- Is this option selected by default?
            let selected = this.value === op.value ? 'selected' : '';

            //-- Generate the html code for that option
            let html = this.htmlComboboxOption(op.value, selected, op.label);

            //-- Store in the array
            opts.push(html);
          });

          //-- Join all the option into a single string
          opts = opts.join('');

          //-- Insert the parameters in the Combox HTML template
          let html = this.htmlTemplate.replace('%LABEL%', this.label);
          html = html.replace('%ID%', this.formId);
          html = html.replace('%OPTIONS%', opts);
          html = html.replace('%SIZE%', this.size);

          return html;
        }

        //---------------------------------------------
        //-- Read the Field value
        //---------------------------------------------
        read() {
          //-- Read the value from the DOM
          let value = $(`#form${this.formId}`).val();

          return value;
        }

        //------------------------------------------------
        //-- Attach a callback function to the change event
        //-- INPUT:
        //--   * callback: Function to execute on change
        //------------------------------------------------
        onChange(callback) {
          $(`#form${this.formId}`).on('change', function () {
            callback($(this).val());
          });
        }
      }

      //---------------------------------------------------------
      //-- BUTTONFIELD. It represents a button in a Form
      //---------------------------------------------------------
      //-- This is how this field is rendered in the Form
      //
      //    [ Button Text ]
      //---------------------------------------------------------
      class ButtonField {
        //-----------------------------------------------------------------------
        //-- Input parameters:
        //--   * text: Text displayed on the button
        //--   * callback: Function to execute when the button is pressed
        //--   * formId: Form identification number
        //-----------------------------------------------------------------------
        constructor(text, callback, formId) {
          //-- Properties
          this.text = text;
          this.callback = callback;
          this.formId = formId;

          //-- Html template for building the button
          //-- The parameters are:
          //--  %TEXT% : Text displayed on the button
          //--  %ID% : Form identification number
          this.htmlTemplate = `<button id="form%ID%" class="ice-button">%TEXT%</button>`;

          //-- Attach the callback directly
          $(document)
            .off('click', `#form${this.formId}`)
            .on('click', `#form${this.formId}`, (event) => {
              event.preventDefault();
              this.callback();
            });
        }

        //---------------------------------------------------------
        //-- Return a string with the HTML code for this button
        //---------------------------------------------------------
        html() {
          //-- Generate the HTML code

          //-- Insert the parameters in the html code template
          let html = this.htmlTemplate.replace('%TEXT%', this.text);
          html = html.replace('%ID%', this.formId);

          return html;
        }

        //---------------------------------------------
        //-- Read the Field value
        //-- For a button, this always returns an empty string
        //---------------------------------------------
        read() {
          return '';
        }
      }

      //---------------------------------------------------------
      //-- GRIDFIELD. It represents a grid in a Form
      //---------------------------------------------------------
      class GridField {
        constructor(formId, className, cols, data) {
          this.cols = cols;
          this.data = data;
          this.tableId = `table${formId}`;
          this.table = null;
          this.className = className;

          //-- Html template for building the grid
          this.htmlTemplate = `
            <div id="%TABLE_ID%" class="%CLASS_NAME%"></div>
          `;
        }

        //---------------------------------------------------------
        //-- Return a string with the HTML code for this grid
        //---------------------------------------------------------
        html() {
          return this.htmlTemplate
            .replace('%TABLE_ID%', `${this.tableId}`)
            .replace('%CLASS_NAME%', `${this.className}`);
        }

        //---------------------------------------------
        init() {
          this.table = jspreadsheet(document.getElementById(this.tableId), {
            data: this.data,
            columns: this.cols,
            rowDrag: true,
            allowInsertRow: true,
            allowDeleteRow: true,
            allowInsertColumn: false,
            allowManualInsertRow: false,
            tableOverflow: true,
            tableHeight: '200px',
          });
        }

        //---------------------------------------------
        //-- Read the Field value
        //-- Return the data in the grid
        //---------------------------------------------
        read() {
          return this.table.getData();
        }
      }

      class Form {
        //-- Build a blank form
        constructor() {
          //-- Array of fields
          this.fields = [];
        }

        //------------------------------------------------------
        //-- Parse the block names. The spaces are removed
        //-- and the individual names obtained (if they are
        //-- separated by comas)
        //--
        //-- INPUT:
        //--   * value: String introduced by the user
        //-- Returns:
        //--   An array of string with the names of the ports
        //------------------------------------------------------
        //-- Example: If the user enters " a, b, c[1:0]",
        //-- It returns: ["a", "b", "c[1:0]"]
        //------------------------------------------------------
        static parseNames(names) {
          //-- First: remove the initial and ending spaces, if any
          let text = names.trim().replace(/\s+/g, '');

          //-- Second: Remove the spaces around the commas (,)
          text = text.replace(/\s*,\s*/g, ',');
          //text = text.replace(' ','');

          //-- Third: Get the Input block names as a list of strings
          let finalNames = text.split(',');
          //-- Return an array with the names
          return finalNames;
        }

        static parsePortName(portName) {
          //-- Pattern for partsin the port names
          let pattern = common.PATTERN_PORT_LABEL;

          return Form.parseNameWithPattern(portName, pattern);
        }

        //---------------------------------------------------
        //-- Parse the Port names
        //--
        //-- INPUT:
        //--   * name: String (Ex: "a[7:0]")
        //--
        //-- Returns:
        //--   * null: No match (Syntax error)
        //--   * PortInfo structure:
        //--      -name: Port name (Ex. "a")
        //--      -rangstr: Range string (Ex. "[7:0]")
        //--      -size: Port size
        //----------------------------------------------------
        static parseNameWithPattern(portName, pattern) {
          //-- Parse the name
          let match = pattern.exec(portName);
          //-- match[0]: global match
          //-- match[1]: Initial word: name
          //-- match[2]: Range (Ex. [7:0])
          //-- match[3]: Most significant byte in the range (Ex. 7)
          //-- match[4]: Less significant byte in the range (Ex. 0)

          if (match) {
            //--There is a full match
            if (match[0] === match.input) {
              //-- Return object
              let portInfo = {};

              //-- Get the name and rangestr
              portInfo.name = match[1] || '';
              portInfo.rangestr = match[2];

              //-- Let's calculate the size

              //-- If it is a bus...
              if (portInfo.rangestr) {
                //-- Get the range left and right numbers
                let left = parseInt(match[3]);
                let right = parseInt(match[4]);
                if (/\D/.test(left) || /\D/.test(right)) {
                  portInfo.size = 2;
                  portInfo.isParametric = true;
                } else {
                  portInfo.size = Math.abs(left - right) + 1;
                  portInfo.isParametric = false;
                }
              }
              //-- It is an isolated wire
              else {
                portInfo.size = 1;
              }
              //-- No more checkings....
              //-- TODO: Size checking
              return portInfo;
            }
          }
          //-- No match
          return null;
        }

        //------------------------------------
        //-- Add a field to the form
        //------------------------------------
        addField(field, tab = null) {
          if (tab === null) {
            this.fields.push(field);
          } else {
            if (Array.isArray(this.fields)) {
              this.fields = {};
            }
            if (!this.fields[tab]) {
              this.fields[tab] = [];
            }
            this.fields[tab].push(field);
          }
        }

        //------------------------------------------------------------------
        //-- Read all the inputs from the fields introduced by the user
        //-- Returns: An array of values
        //------------------------------------------------------------------
        readFields() {
          //-- Array were the values will be stored
          let values = [];

          //-- Read the values from the Form fields
          //-- and insert them into the values array
          if (Array.isArray(this.fields)) {
            this.fields.forEach((field) => {
              //-- Read the value from the field
              let value = field.read();

              //-- Add the value to the array
              values.push(value);
            });
          } else {
            Object.keys(this.fields).forEach((tab) => {
              this.fields[tab].forEach((field) => {
                //-- Read the value from the field
                let value = field.read();

                //-- Add the value to the array
                values.push(value);
              });
            });
          }

          //-- Return all the values
          return values;
        }

        //-------------------------------------
        //-- Generate the HTML of the form
        //-------------------------------------
        html() {
          //-- Variable for storing the html code
          let formHtml = [];

          //-- Variable for storing the field HTML code
          let fieldHtml;

          //-- Initial tag for the Form
          formHtml.push('<div>');

          if (Array.isArray(this.fields)) {
            //-- Generate the html for all the fields in the form
            this.fields.forEach((field) => {
              //-- Create the html code
              fieldHtml = field.html();

              //-- Store the html for this Field
              formHtml.push(fieldHtml);
            });
          } else {
            //-- Generate the tabs
            formHtml.push('<ul class="tabs">');
            Object.keys(this.fields).forEach((tab, index) => {
              let activeClass = index === 0 ? 'active' : '';
              formHtml.push(
                `<li class="tab-item ${activeClass}" data-tab="${tab}">${tab}</li>`
              );
            });
            formHtml.push('</ul>');

            //-- Generate the html for all the fields in the tab
            Object.keys(this.fields).forEach((tab, index) => {
              let activeClass = index === 0 ? 'active' : '';
              formHtml.push(
                `<div class="tab-content ${activeClass}" data-content="${tab}">`
              );

              this.fields[tab].forEach((field) => {
                fieldHtml = field.html();
                formHtml.push(fieldHtml);
              });

              formHtml.push('</div>');
            });
          }

          //-- Closing tag for the Form
          formHtml.push('</div>');

          //-- Create the string
          let html = formHtml.join('\n');

          //-- return the HTML code
          return html;
        }

        init() {
          if (Array.isArray(this.fields)) {
            //-- Initialize the fields
            this.fields.forEach((field) => {
              if ('init' in field) {
                field.init();
              }
            });
          } else {
            //-- Initialize the fields
            Object.keys(this.fields).forEach((tab) => {
              this.fields[tab].forEach((field) => {
                if ('init' in field) {
                  field.init();
                }
              });
            });
          }
        }

        //-----------------------------------------------------------------
        //-- Display the Form
        //-- INPUT:
        //--   * callback: Function called when the OK button is pressed
        //-----------------------------------------------------------------
        display(callback) {
          //-- Create the HTML
          let html = this.html();
          const self = this;

          const dialog = alertify.confirm();
          dialog.setContent(html);

          //-- Set the callback for the OK button
          dialog.set('onok', callback);

          //-- Set the callback for the Cancel button:
          //--   Do nothing...
          dialog.set('oncancel', function (/*evt*/) {});

          //-- Set the callback for the show event:
          dialog.set('onshow', function () {
            self.init();
          });

          dialog.show();

          $(document).on('click', '.tabs .tab-item', function () {
            const selectedTab = $(this).attr('data-tab');

            $('.tabs .tab-item').removeClass('active');
            $(this).addClass('active');

            $('.tab-content').removeClass('active').hide();
            $(`.tab-content[data-content="${selectedTab}"]`)
              .addClass('active')
              .show();
          });
        }
      }

      //-------------------------------------------------------------
      //-- Class for modeling the Forms for the Input and Output
      //--    ports. All their common stuff is place here
      //-------------------------------------------------------------
      class FormBasicPort extends Form {
        //--------------------------------------------------
        //-- INPUTS:
        //--   * msg: Message above the text box
        //--   * name: Default port name
        //--   * virtual: Is this a virtual or real port?
        //--------------------------------------------------
        constructor(msg, name = '', virtual = false, disabled = false) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //-------- Add the diffent Fields:
          //-- Field 0: Text input
          let field0 = new TextField(
            msg, //-- Top message
            name, //-- Default value
            0 //-- Field id
          );

          //-- Field 1: Checkbox for selecting if the input block
          //-- is an FPGA pin or an internal port
          let field1 = new CheckboxField(
            gettextCatalog.getString('FPGA pin'),
            !virtual, //-- Default value
            1, //-- Field id
            disabled //-- Disabled attribute
          );

          //-- Add the fields to the form
          this.addField(field0);
          this.addField(field1);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();

          //-- Values[0]: Input pin names
          //-- Parse the input names
          this.names = Form.parseNames(this.values[0]);
          //-- Values[1] indicates if it is a virtual pin or not
          this.virtual = !this.values[1];
        }

        //-----------------------------------------------------------------------
        //-- Get the Information of the port(s): name, range, size...
        //-- and store it in the portInfo property
        //--
        //-- ERRORs are check and Notifications raised in case of errors
        //------------------------------------------------------------------------
        getPortInfo(evt) {
          let portInfo;
          this.portInfos = [];

          //-- Check all the ports (The user may have include one or more)
          for (let name of this.names) {
            //-- Get the port Info: port name, size...
            portInfo = Form.parseNameWithPattern(
              name,
              //common.PATTERN_GLOBAL_PORT_LABEL
              common.PATTERN_PORT_LABEL
            );
            //-- No portInfo... The was a syntax error
            if (!portInfo) {
              //-- Do not close the form
              evt.cancel = true;

              //-- Show a warning notification
              this.resultAlert = alertify.warning(
                gettextCatalog.getString('Wrong block name {{name}}', {
                  name: name,
                })
              );
              return;
            }

            //-- TODO: Check sizes

            //-- Store the current portInfo
            this.portInfos.push(portInfo);
          }

          //-- Close the form when finish
          evt.cancel = false;
        }

        //------------------------------------------------
        //-- Process the information enter by the user
        //------------------------------------------------
        process(evt) {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();

          //-- Get the ports info and check for errors
          this.getPortInfo(evt);
        }

        //-------------------------------------------------------------
        //-- Create the blocks defined in the form
        //-- Call this methods only when the form has been processed!
        //-------------------------------------------------------------
        newBlocks() {
          //-- Array for storing all the blocks created
          let blocks = [];
          let block;

          for (let i in this.portInfos) {
            //-- Create the block
            block = this.newBlock(i);

            //-- Store this block in the array
            blocks.push(block);
          }

          //-- Return an array of Blocks
          return blocks;
        }
      }

      class FormBasicInput extends FormBasicPort {
        //-------------------------------------------------------------------------
        //-- Create the form for the INPUT PORTS
        //-------------------------------------------------------------------------
        //-- Form:
        //----------------------------------------+
        //--    Enter the input blocks            |
        //--    +--------------------------+      |
        //--    | Pin names                |      |
        //--    +--------------------------+      |
        //--                                      |
        //--    [✅️] FPGA pin                     |
        //--    [  ] Show clock                   |
        //--    [  ] InOut pin (*Optional)        |
        //----------------------------------------+
        //-- INPUTS:
        //--   * name: Default port name
        //--   * virtual: Is this a virtual or real port?
        //--   * clock: The input pin carries a clock signal
        //--   * disabled: FPGA-pin checkbox disabled
        //--   * inoutValue: If undefined, InOut-pin checkbox is hidden
        //       Otherwise, it is a boolean value to initialize the checkbox
        constructor(
          name = '',
          virtual = false,
          clock = false,
          disabled = false,
          inoutValue = undefined
        ) {
          //-- Create a blank BasicPortForm (calling the upper Class)
          super(
            gettextCatalog.getString('Input port names'),
            name,
            virtual,
            disabled
          );

          //-- Store the type of block associated with the Form
          this.type = blocks.BASIC_INPUT;

          //-------- Add the particular fields

          //-- Field 2: Checkbox for configuring the input pin
          //--          as a clock
          let field2 = new CheckboxField(
            gettextCatalog.getString('Show clock'),
            clock, //-- Default value
            2 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field2);

          //-- Field 3: Checkbox for configuring the pin as inout
          if (inoutValue !== undefined) {
            let field3 = new CheckboxField(
              gettextCatalog.getString('\"Inout\" pin'),
              inoutValue, //-- Default value
              3 //-- Field id
            );

            //-- Add the fields to the form
            this.addField(field3);
          }

          //-- Store the initial values
          //-- (For comparing it later with the new ones and detect if
          //--  there have been changes)
          this.nameIni = name;
          this.virtualIni = virtual;
          this.clockIni = clock;
          if (inoutValue !== undefined) {
            this.inoutIni = inoutValue;
          }
        }

        //------------------------------------------------
        //-- Process the information entered by the user
        //------------------------------------------------
        process(evt) {
          //-- First, Process the form as a BasicPort
          super.process(evt);

          //-- Second: Process the particular fields

          //-- Input port have the clock property
          //-- it indicates if this is a clock input
          this.clock = this.values[2];

          //-- There may be no inout field in Values (undefined)
          //-- If inout field is present, it indicates if this pin is an inout type
          this.inout = this.values[3];

          //-- Check all ports again... There could be no data buses defined
          //-- as clocks (it is only for 1-wire ports)
          for (let portInfo of this.portInfos) {
            //-- Check particular errors
            //-- Error: Buses cannot be clocks...
            if (portInfo.rangestr && this.clock) {
              evt.cancel = true;

              //-- Show a notification with the warning
              this.resultAlert = alertify.warning(
                gettextCatalog.getString('Clock not allowed for data buses')
              );

              //-- Processing not yet finished
              return;
            }
          }

          //-- There have been no errors. Detect if there have been some
          //-- changes in the values
          this.changed =
            this.nameIni !== this.values[0] ||
            this.virtualIni !== this.virtual ||
            this.clockIni !== this.clock ||
            (this.hasOwnProperty('inoutIni') && this.inoutIni !== this.inout);
        }

        //-------------------------------------------------------------
        //-- Create the block define in the form
        //-- Call this method only when the form has been processed!
        //--
        //-- INPUTS:
        //--   * n:  Number of block to create
        //--
        //-- RETURN:
        //--   * The InputBasicPort block
        //-------------------------------------------------------------
        newBlock(n) {
          //-- Create all the blocks defined
          let portInfo = this.portInfos[n];

          //-- Create an array of empty pins (with name and values
          //-- set to 'NULL')
          let pins = blocks.getPins(portInfo);
          let block = new blocks.InputPortBlock(
            portInfo.name,
            this.virtual,
            portInfo.rangestr,
            pins,
            this.clock,
            this.inout,
            portInfo.isParametric
          );

          return block;
        }
      }

      class FormBasicOutput extends FormBasicPort {
        //-------------------------------------------------------------------------
        //-- Create the form for the OUTPUT PORTS
        //-------------------------------------------------------------------------
        //-- Form:
        //----------------------------------------+
        //--    Enter the output blocks           |
        //--    +--------------------------+      |
        //--    | Pin names                |      |
        //--    +--------------------------+      |
        //--                                      |
        //--    [✅️] FPGA pin                     |
        //--    [  ] InOut pin (*Optional)        |
        //----------------------------------------+
        //-- INPUTS:
        //--   * name: Default port name
        //--   * virtual: Is this a virtual or real port?
        //--   * disabled: FPGA-pin checkbox disabled
        //--   * inoutValue: If undefined, InOut-pin checkbox is hidden
        //       Otherwise, it is a boolean value to initialize the checkbox
        constructor(
          name = '',
          virtual = false,
          disabled = false,
          inoutValue = undefined
        ) {
          //-- Create a blank BasicPortForm (calling the upper Class)
          super(
            gettextCatalog.getString('Output port names'),
            name,
            virtual,
            disabled
          );

          //-- Store the type of block associated with the Form
          this.type = blocks.BASIC_OUTPUT;

          //-------- Add the particular fields

          //-- Field 2: Checkbox for configuring the pin as inout
          if (inoutValue !== undefined) {
            let field2 = new CheckboxField(
              gettextCatalog.getString('\"Inout\" pin'),
              inoutValue, //-- Default value
              2 //-- Field id
            );

            //-- Add the field to the form
            this.addField(field2);
          }

          //-- Store the initial values
          //-- (For comparing it later with the new ones and detect if
          //--  there have been changes)
          this.nameIni = name;
          this.virtualIni = virtual;
          if (inoutValue !== undefined) {
            this.inoutIni = inoutValue;
          }
        }

        process(evt) {
          //-- Process the form as an BasicPort
          super.process(evt);

          //-- There may be no inout field in Values (undefined)
          //-- If inout field is present, it indicates if this pin is an inout type
          this.inout = this.values[2];

          //-- There have been no errors. Detect if there have been some
          //-- changes in the values
          this.changed =
            this.nameIni !== this.values[0] ||
            this.virtualIni !== this.virtual ||
            (this.hasOwnProperty('inoutIni') && this.inoutIni !== this.inout);
        }

        //-------------------------------------------------------------
        //-- Create the block define in the form
        //-- Call this method only when the form has been processed!
        //--
        //-- INPUTS:
        //--   * n:  Number of block to create
        //--
        //-- RETURN:
        //--   * The OutputBasicPort block
        //-------------------------------------------------------------
        newBlock(n) {
          //-- Create all the blocks defined
          let portInfo = this.portInfos[n];

          //-- Create an array of empty pins (with name and values
          //-- set to 'NULL')
          let pins = blocks.getPins(portInfo);

          //-- Create the block
          let block = new blocks.OutputPortBlock(
            portInfo.name,
            this.virtual,
            portInfo.rangestr,
            pins,
            this.inout
          );

          //-- Return the block
          return block;
        }
      }

      //-------------------------------------------------------------
      //-- Class for modeling the Forms for the Input and Output
      //-- labels. All their common stuff is place here
      //-------------------------------------------------------------
      class FormBasicLabel extends Form {
        //-----------------------------------------------------
        //-- INPUTS:
        //--    * msg: Message above the text box
        //--    * name: Default label name
        //--    * color: Default label color
        //------------------------------------------------------
        constructor(msg, name = '', color = 'fuchsia') {
          //-- Create a blank Form (calling the upper Class)
          super();

          //-- Add the different Fields
          //-- Field 0: Text input: label name
          let field0 = new TextField(
            msg, //-- Top message
            name, //-- Default value
            0 //-- Field id
          );

          //-- Field 1: Color Selector. Label color
          let field1 = new ColorField(
            gettextCatalog.getString('Choose a color:'),
            color //-- Default color
          );

          //-- Add the fields to the form
          this.addField(field0);
          this.addField(field1);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;

          //-- Store the initial values
          //-- (For comparing it later with the new ones and detect if
          //--  there have been changes)
          this.nameIni = name;
          this.colorIni = color;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();

          //-- Values[0]: Label names
          //-- Parse the names
          this.names = Form.parseNames(this.values[0]);

          //-- Values[1]: Label color
          this.color = this.values[1];
        }

        //-----------------------------------------------------------------------
        //-- Get the Information of the port(s): name, range, size...
        //-- and store it in the portInfo property
        //--
        //-- ERRORs are check and Notifications raised in case of errors
        //------------------------------------------------------------------------
        getPortInfo(evt) {
          let portInfo;
          this.portInfos = [];

          //-- Check all the ports (The user may have include one or more)
          for (let name of this.names) {
            //-- Get the port Info: port name, size...
            portInfo = Form.parsePortName(name);

            //-- No portInfo... The was a syntax error
            if (!portInfo) {
              //-- Do not close the form
              evt.cancel = true;

              //-- Show a warning notification
              this.resultAlert = alertify.warning(
                gettextCatalog.getString('Wrong block name {{name}}', {
                  name: name,
                })
              );
              return;
            }

            //-- TODO: Check sizes

            //-- Store the current portInfo
            this.portInfos.push(portInfo);
          }

          //-- Close the form when finish
          evt.cancel = false;
        }

        //------------------------------------------------
        //-- Process the information entered by the user
        //------------------------------------------------
        process(evt) {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();

          //-- Get the ports info and check for errors
          this.getPortInfo(evt);
        }

        //-------------------------------------------------------------
        //-- Create the blocks defined in the form
        //-- Call this methods only when the form has been processed!
        //-------------------------------------------------------------
        newBlocks() {
          //-- Array for storing all the blocks created
          let blocks = [];
          let block;

          for (let i in this.portInfos) {
            //-- Create the block
            block = this.newBlock(i);

            //-- Store this block in the array
            blocks.push(block);
          }

          //-- Return an array of Blocks
          return blocks;
        }
      }

      //-----------------------------------------------------------
      //-- Class for modeling the Forms for the Input Labels
      //-----------------------------------------------------------
      class FormBasicInputLabel extends FormBasicLabel {
        //---------------------------------------------
        //-- Create the form for the INPUT Labels
        //---------------------------------------------
        //-- Form:
        //----------------------------------------+
        //--    Enter the input label             |
        //--    +--------------------------+      |
        //--    | Label names              |      |
        //--    +--------------------------+      |
        //--                                      |
        //--    Chose a color                     |
        //--    +--------------------------+      |
        //--    | o Fucshia                |      |
        //--    +--------------------------+      |
        //--                                      |
        //----------------------------------------+
        //-- INPUTS:
        //--   * name: Default Label name
        //--   * color: Default label color
        //---------------------------------------------
        constructor(name = '', color = 'fuchsia') {
          //-- Create a blank BasicLabelForm (calling the upper Class)
          super(gettextCatalog.getString('Output labels'), name, color);

          //-- Store the type of block associated with the Form
          this.type = blocks.BASIC_INPUT_LABEL;

          //-------- Input Label port DO NOT have particular fields
        }

        process(evt) {
          //-- Process the form as an BasicPort
          super.process(evt);

          //-- No particular processing for Output ports

          //-- There have been no errors. Detect if there have been some
          //-- changes in the values
          this.changed =
            this.nameIni !== this.values[0] || this.colorIni !== this.color;
        }

        //-------------------------------------------------------------
        //-- Create the block define in the form
        //-- Call this method only when the form has been processed!
        //--
        //-- INPUTS:
        //--   * n:  Number of block to create
        //--
        //-- RETURN:
        //--   * The InputBasicPort block
        //-------------------------------------------------------------
        newBlock(n) {
          //-- Get the info of the label n
          let portInfo = this.portInfos[n];

          //-- Create an array of empty pins (with name and values
          //-- set to 'NULL')
          let pins = blocks.getPins(portInfo);

          //-- Create the Label block
          let block = new blocks.InputLabelBlock(
            portInfo.name,
            portInfo.rangestr,
            this.color,
            pins
          );

          return block;
        }
      }

      class FormBasicOutputLabel extends FormBasicLabel {
        //---------------------------------------------
        //-- Create the form for the OUTPUT Labels
        //---------------------------------------------
        //-- Form:
        //----------------------------------------+
        //--    Enter the input label             |
        //--    +--------------------------+      |
        //--    | Label names              |      |
        //--    +--------------------------+      |
        //--                                      |
        //--    Chose a color                     |
        //--    +--------------------------+      |
        //--    | o Fucshia                |      |
        //--    +--------------------------+      |
        //--                                      |
        //----------------------------------------+
        //-- INPUTS:
        //--   * name: Default Label name
        //--   * color: Default label color
        //---------------------------------------------
        constructor(name = '', color = 'fuchsia') {
          //-- Create a blank BasicLabelForm (calling the upper Class)
          super(gettextCatalog.getString('Input labels'), name, color);

          //-- Store the type of block associated with the Form
          this.type = blocks.BASIC_OUTPUT_LABEL;

          //-------- Output Label port do not have particular fields
        }

        process(evt) {
          //-- Process the form as an BasicPort
          super.process(evt);

          //-- No particular processing for Output ports

          //-- There have been no errors. Detect if there have been some
          //-- changes in the values
          this.changed =
            this.nameIni !== this.values[0] || this.colorIni !== this.color;
        }

        //-------------------------------------------------------------
        //-- Create the block define in the form
        //-- Call this method only when the form has been processed!
        //--
        //-- INPUTS:
        //--   * n:  Number of block to create
        //--
        //-- RETURN:
        //--   * The InputBasicPort block
        //-------------------------------------------------------------
        newBlock(n) {
          //-- Get the info of the label n
          let portInfo = this.portInfos[n];

          //-- Create an array of empty pins (with name and values
          //-- set to 'NULL')
          let pins = blocks.getPins(portInfo);

          //-- Create the Label block
          let block = new blocks.OutputLabelBlock(
            portInfo.name,
            portInfo.rangestr,
            this.color,
            pins
          );

          return block;
        }
      }

      class FormBasicPairedLabels extends FormBasicLabel {
        constructor(name = '', color = 'fuchsia') {
          //-- Create a blank BasicLabelForm (calling the upper Class)
          super(
            gettextCatalog.getString('Names of the paired labels'),
            name,
            color
          );

          //-- Store the type of block associated with the Form
          this.type = blocks.BASIC_PAIRED_LABEL;
        }

        //-------------------------------------------------------------
        //-- Create the block define in the form
        //-- Call this method only when the form has been processed!
        //--
        //-- INPUTS:
        //--   * n:  Number of block to create
        //--
        //-- RETURN:
        //--   * The InputBasicPort block
        //-------------------------------------------------------------
        newBlock(n) {
          //-- Get the info of the label n
          let portInfo = this.portInfos[n];

          //-- Create an array of empty pins (with name and values
          //-- set to 'NULL')
          let pins = blocks.getPins(portInfo);

          //-- Create the Paired labels: Input
          let block1 = new blocks.InputLabelBlock(
            portInfo.name,
            portInfo.rangestr,
            this.color,
            pins
          );

          //-- Create the Paired labels: Output
          let block2 = new blocks.OutputLabelBlock(
            portInfo.name,
            portInfo.rangestr,
            this.color,
            pins
          );

          //-- Array with the paired labels
          let pairedLabels = [block1, block2];

          //-- Return the array of paired labels
          return pairedLabels;
        }
      }

      //-------------------------------------------------------------------------
      //-- CLASS: Creating/Editing a Basic Code block
      //-------------------------------------------------------------------------
      class FormBasicCode extends Form {
        //-----------------------------------------------------------------
        //-- INPUTS:
        //--   * portsIn: Input port names (separated by commas)
        //--   * portsOut: Output port names (separated by commas)
        //--   * paramsIn: Input parameters names (separated by commas)
        //--   * portsInOutLeft: If undefined, InputOutput port names field is hidden
        //       Otherwise, it is string of port names (separated by commas) to populate the field
        //--   * portsInOutRight: If undefined, InputOutput port names field is hidden
        //       Otherwise, it is string of port names (separated by commas) to populate the field
        //-----------------------------------------------------------------
        constructor(
          portsIn = '',
          portsOut = '',
          paramsIn = '',
          portsInOutLeft = '',
          portsInOutRight = ''
        ) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //--- Add the different Fields:

          //-- Field 0: Input port names
          let field0 = new TextField(
            gettextCatalog.getString('Input ports'), //-- Top message
            portsIn, //-- Default Input port names
            0 //-- Field id
          );

          //-- Field 1: Output port names
          let field1 = new TextField(
            gettextCatalog.getString('Output ports'), //-- Top message
            portsOut, //-- Default Output port names
            1 //-- Field id
          );

          //-- Field 2: Input params
          let field2 = new TextField(
            gettextCatalog.getString('Input parameters'), //-- Top message
            paramsIn, //-- Default Input parameter names
            2 //-- Field id
          );

          const modulePortsLabel = gettextCatalog.getString('Module Ports');

          this.addField(field0, modulePortsLabel);
          this.addField(field1, modulePortsLabel);
          this.addField(field2, modulePortsLabel);
          let field3 = false;
          let field4 = false;

          const allowInoutPorts =
            profile.get('allowInoutPorts') || common.allowProjectInoutPorts;
          if (allowInoutPorts) {
            //-- Optional fields
            //-- Field 3: InputOutput port names at the left
            field3 = new TextField(
              gettextCatalog.getString('\"Inout\" Left ports'), //-- Top message
              portsInOutLeft, //-- Default InputOutput port names at the left
              3 //-- Field id
            );

            //-- Add the field to the form
            this.addField(field3, modulePortsLabel);

            //-- Field 4: InputOutput port names at the right
            field4 = new TextField(
              gettextCatalog.getString('\"Inout\" Right ports'), //-- Top message
              portsInOutRight, //-- Default InputOutput port names at the right
              4 //-- Field id
            );

            //-- Add the field to the form
            this.addField(field4, modulePortsLabel);
          }

          const toolsLabel = gettextCatalog.getString('Tools');

          let field5 = new LabelField(
            gettextCatalog.getString('Import Verilog code from file'), //-- Label text
            5 //-- Field id
          );
          this.addField(field5, toolsLabel);

          this.code = '';
          let self = this;

          //-- Field 6: Import code
          let field6 = new ButtonField(
            gettextCatalog.getString('Import code'), //-- Button text
            function () {
              //-- Callback
              //-- Open the file Dialog
              //-- The selector is passed as a parameter
              //-- The html element is located in the menu.html file
              utils.openDialog(
                '#input-import-verilog',
                async function (filepath) {
                  try {
                    // Leer el archivo de forma asíncrona
                    const content = await nodeFs.promises.readFile(
                      filepath,
                      'utf8'
                    );

                    // Parsear el contenido del archivo
                    const result = await utils.parseVerilog(content);

                    // Actualizar los campos con los resultados del parseo
                    portsIn = result.inputs;
                    portsOut = result.outputs;
                    paramsIn = result.parameters;
                    field0.write(result.inputs);
                    field1.write(result.outputs);
                    field2.write(result.parameters);

                    if (result.inouts.length > 0) {
                      if (field3) {
                        field3.write(result.inouts);
                      } else {
                        alertify.error(
                          gettextCatalog.getString(
                            'Design contains tri-state I/O. You need to update your Preferences:<br />&nbsp;&nbsp;&nbsp;<b>Advanced features → Allow tri-state connections</b>,<br />and reimport the block.'
                          ),
                          20000
                        );
                      }
                    }

                    // Almacenar el cuerpo del módulo
                    self.code = result.moduleBody;

                    $('[data-tab="Module Ports"]').click();
                  } catch (err) {
                    alertify.error(
                      gettextCatalog.getString(
                        'Error reading the file: {{error}}',
                        { error: err.message }
                      )
                    );
                  }
                }
              );
            },
            6 //-- Field id
          );

          this.addField(field6, toolsLabel);

          //-------- Field 7: Combobox for selecting the display mode
          //-- Options
          let options = [
            {
              value: 1,
              label: gettextCatalog.getString('Grid'),
            },
            {
              value: 2,
              label: gettextCatalog.getString('Manual'),
            },
          ];

          const columns = [
            { type: 'text', title: 'Name', width: 150 },
            {
              type: 'dropdown',
              title: 'Type',
              width: 70,
              source: ['IN', 'OUT', 'BIDI'],
            },
            { type: 'numeric', title: 'Bus width', width: 80 },
            { type: 'checkbox', title: 'Signed', width: 55 },
            { type: 'checkbox', title: 'Registered', width: 80 },
            { type: 'checkbox', title: 'Enable', width: 60 },
          ];
          const data = [['', 'IN', 0, false, false, true]];

          let field7 = new GridField(7, 'ports-table', columns, data);
          this.addField(field7, modulePortsLabel);

          field0.onChange((value) => {
            updateIOPortsTable(field7.table, value, 'IN');
          });
          field1.onChange((value) => {
            updateIOPortsTable(field7.table, value, 'OUT');
          });
          if (allowInoutPorts) {
            field3.onChange((value) => {
              updateIOPortsTable(field7.table, value, 'BIDI');
            });
            field4.onChange((value) => {
              updateIOPortsTable(field7.table, value, 'BIDI');
            });
          }

          let field8 = new ComboboxField(
            options,
            gettextCatalog.getString('Display mode:'), //-- Top message
            1, //-- Default value
            8, //-- Field id
            'fit-content' //-- Width
          );

          this.addField(field8, modulePortsLabel);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;

          //-- Store the initial values used for creating the form
          //-- They will be used later for detecting a change in
          //-- the values introduced by the user
          this.iniPortsIn = portsIn;
          this.iniPortsOut = portsOut;
          this.iniParamsIn = paramsIn;
          if (portsInOutLeft !== undefined && portsInOutRight !== undefined) {
            this.iniPortsInOutLeft = portsInOutLeft;
            this.iniPortsInOutRight = portsInOutRight;
          }
        }

        //-----------------------------------------------------------------------
        //-- Get the Information of the port(s): name, range, size...
        //-- and store it in the portInfo property
        //--
        //-- ERRORs are check and Notifications raised in case of errors
        //------------------------------------------------------------------------
        getPortInfo(names, evt) {
          let portInfo;
          let portInfos = [];

          //-- Check all the port names
          for (let name of names) {
            //-- Get the port Info: port name, size...
            portInfo = Form.parsePortName(name);
            //-- No portInfo... The was a syntax error
            if (!portInfo) {
              //-- Do not close the form
              evt.cancel = true;

              //-- Show a warning notification
              this.resultAlert = alertify.warning(
                gettextCatalog.getString('Wrong block name {{name}}', {
                  name: name,
                })
              );
              return;
            }

            //-- TODO: Check sizes

            //-- Store the current portInfo
            if (portInfo.name !== '') {
              portInfos.push(portInfo);
            }
          }

          //-- Close the form when finish
          evt.cancel = false;

          return portInfos;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();

          //-- Values[0]: Input port names
          //-- Parse the input port names
          this.inPorts = Form.parseNames(this.values[0].replace(/\s+/g, ''));

          //-- Values[1]: Output port names
          //-- Parse the output port names
          this.outPorts = Form.parseNames(this.values[1].replace(/\s+/g, ''));

          //-- Values[2]: Input parameters
          //-- Parse the input parameters
          this.inParams = Form.parseNames(this.values[2].replace(/\s+/g, ''));

          //-- Values[3]: InputOutput port names at the left of the block
          //-- If field is present in Values, then parse the inout port names
          if (this.values[3]) {
            this.inoutLeftPorts = Form.parseNames(
              this.values[3].replace(/\s+/g, '')
            );
          }

          //-- Values[4]: InputOutput port names at the right of the block
          //-- If field is present in Values, then parse the inout port names
          if (this.values[4]) {
            this.inoutRightPorts = Form.parseNames(
              this.values[4].replace(/\s+/g, '')
            );
          }
        }

        //------------------------------------------------
        //-- Process the information enter by the user
        //------------------------------------------------
        process(evt) {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();

          //-- Get the ports info and check for errors
          this.inPortsInfo = this.getPortInfo(this.inPorts, evt);
          this.outPortsInfo = this.getPortInfo(this.outPorts, evt);
          this.inParamsInfo = this.getPortInfo(this.inParams, evt);
          if (this.hasOwnProperty('inoutLeftPorts')) {
            this.inoutLeftPortsInfo = this.getPortInfo(
              this.inoutLeftPorts,
              evt
            );
          }
          if (this.hasOwnProperty('inoutRightPorts')) {
            this.inoutRightPortsInfo = this.getPortInfo(
              this.inoutRightPorts,
              evt
            );
          }

          //-- Validate values entered by the user
          //-- There cannot be inputs, outputs and params with the same name
          //-- Check it!!!

          //-- Array for storing all the port names created
          let allPortnames = [];

          //-- Array with the inputs and outputs given by the user
          let userPorts = this.inPortsInfo.concat(this.outPortsInfo);

          //-- Add the array with the input parameters
          userPorts = userPorts.concat(this.inParamsInfo);

          //-- Add the optional arrays with the left/right InputOutput ports
          if (this.inoutLeftPortsInfo && this.inoutRightPortsInfo) {
            userPorts = userPorts.concat(
              this.inoutLeftPortsInfo,
              this.inoutRightPortsInfo
            );
          }

          //-- Analyze all the port names, one by one
          for (let portInfo of userPorts) {
            //-- The current element is only checked if it exist
            if (portInfo) {
              //-- Check if the current name is already in the array
              if (allPortnames.includes(portInfo.name)) {
                //-- It means that the port name is duplicated
                //-- Show an error and return
                evt.cancel = true;
                this.resultAlert = alertify.warning(
                  gettextCatalog.getString('Duplicate port name: {{name}}', {
                    name: portInfo.name,
                  })
                );
                return;
              }

              //-- Name is unique so far. Insert it into the array
              allPortnames.push(portInfo.name);
            }
          }
        }

        //-----------------------------------------------------------------------
        //-- Detect if the form was changed by the user
        //--
        //--  RETURN: A boolean value indicating the change
        //--    * true: There was a change in the block
        //--    * false: No change in the block
        //-----------------------------------------------------------------------
        changed() {
          //-- Convert the ports into strings and compare them with the initial
          //-- values used when creating the form

          //-- Get the input port names as a string
          let inPortNames = blocks.portsInfo2Str(this.inPortsInfo);

          //-- Get the output port names as a string
          let outPortNames = blocks.portsInfo2Str(this.outPortsInfo);

          //-- Get the input param names as a string
          let inParamNames = blocks.portsInfo2Str(this.inParamsInfo);

          //-- Get the optional left/right InputOutput port names as strings
          let inoutLeftPortNames;
          let inoutRightPortNames;

          if (this.inoutLeftPortsInfo && this.inoutRightPortsInfo) {
            inoutLeftPortNames = blocks.portsInfo2Str(this.inoutLeftPortsInfo);

            inoutRightPortNames = blocks.portsInfo2Str(
              this.inoutRightPortsInfo
            );
          }

          //-- Compare these values with the initial ones
          //-- to detec if there has been a change
          //-- All the items compared are Strings
          let changed =
            this.iniPortsIn !== inPortNames ||
            this.iniPortsOut !== outPortNames ||
            this.iniParamsIn !== inParamNames ||
            (this.hasOwnProperty('iniPortsInOutLeft') &&
              this.iniPortsInOutLeft !== inoutLeftPortNames) ||
            (this.hasOwnProperty('iniPortsInOutRight') &&
              this.iniPortsInOutRight !== inoutRightPortNames);

          //-- Return a boolean value
          return changed;
        }
      }

      class FormBasicMemory extends Form {
        constructor(names = '', value = 10, local = false) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //----- Add the different Fields:

          //-- Field 0: Memory block names
          let field0 = new TextField(
            gettextCatalog.getString('Memory block names'), //-- Top message
            names, //-- Default names
            0 //-- Field id
          );

          //-------- Field 1: Combobox

          //-- Options
          let options = [
            {
              value: 2,
              label: gettextCatalog.getString('Binary'),
            },
            {
              value: 10,
              label: gettextCatalog.getString('Decimal'),
            },
            {
              value: 16,
              label: gettextCatalog.getString('Hexadecimal'),
            },
          ];

          let field1 = new ComboboxField(
            options,
            gettextCatalog.getString('Address format'), //-- Top message
            value, //-- Default value
            1 //-- Field id
          );

          //-- Field 2: Checkbox for selecting if the memory is a
          //-- local parameter or not
          let field2 = new CheckboxField(
            gettextCatalog.getString('Local parameter'),
            local, //-- Default value
            2 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field0);
          this.addField(field1);
          this.addField(field2);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;

          //-- Store the initial values
          //-- (For comparing it later with the new ones and detect if
          //--  there have been changes)
          this.nameIni = names;
          this.valueIni = value;
          this.localIni = local;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();

          //-- Values[0]: Memory names
          //-- Parse the memory names
          this.names = Form.parseNames(this.values[0].replace(/\s+/g, ''));

          //-- Values[1] is the combobox value
          this.value = parseInt(this.values[1]);

          //-- Values[2] is the checkbox that indicates if the memory
          //-- is a local parameter or not
          this.local = this.values[2];
        }

        //-----------------------------------------------------------------------
        //-- Get the Information of the port(s): name, range, size...
        //-- and store it in the portInfo property
        //--
        //-- ERRORs are check and Notifications raised in case of errors
        //------------------------------------------------------------------------
        getPortInfo(evt) {
          let portInfo;
          this.portInfos = [];

          //-- Check all the ports (The user may have include one or more)
          for (let name of this.names) {
            //-- Get the port Info: port name, size...
            portInfo = Form.parsePortName(name);

            //-- No portInfo... The was a syntax error
            if (!portInfo) {
              //-- Do not close the form
              evt.cancel = true;

              //-- Show a warning notification
              this.resultAlert = alertify.warning(
                gettextCatalog.getString('Wrong block name {{name}}', {
                  name: name,
                })
              );
              return;
            }

            //-- TODO: Check sizes

            //-- Store the current portInfo
            this.portInfos.push(portInfo);
          }

          //-- Close the form when finish
          evt.cancel = false;
        }

        //------------------------------------------------
        //-- Process the information enter by the user
        //------------------------------------------------
        process(evt) {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();

          //-- Get the ports info and check for errors
          this.getPortInfo(evt);
        }

        //-------------------------------------------------------------
        //-- Create the blocks defined in the form
        //-- Call this methods only when the form has been processed!
        //-------------------------------------------------------------
        newBlocks() {
          //-- Array for storing all the blocks created
          let blocks = [];
          let block;

          for (let i in this.portInfos) {
            //-- Create the block
            block = this.newBlock(i);

            //-- Store this block in the array
            blocks.push(block);
          }

          //-- Return an array of Blocks
          return blocks;
        }

        //-------------------------------------------------------------
        //-- Create the block defined in the form
        //-- Call this method only when the form has been processed!
        //--
        //-- INPUTS:
        //--   * n:  Number of block to create
        //--
        //-- RETURN:
        //--   * The Memory block
        //-------------------------------------------------------------
        newBlock(n) {
          //-- Create the block
          let block = new blocks.MemoryBlock(
            this.names[n],
            '',
            this.local,
            this.value
          );

          return block;
        }

        //-----------------------------------------------------------------------
        //-- Detect if the form was changed by the user
        //--
        //--  RETURN: A boolean value indicating the change
        //--    * true: There was a change in the block
        //--    * false: No change in the block
        //-----------------------------------------------------------------------
        changed() {
          //-- Compare these values with the initial ones
          //-- to detec if there has been a change
          //-- All the items compared are Strings
          let changed =
            this.nameIni !== this.values[0] ||
            this.valueIni !== this.value ||
            this.localIni !== this.local;

          //-- Return a boolean value
          return changed;
        }
      }

      class FormBasicConstant extends Form {
        constructor(names = '', local = false) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //----- Add the different Fields:

          //-- Field 0: Constant names
          let field0 = new TextField(
            gettextCatalog.getString('Constant names'), //-- Top message
            names, //-- Constant block names
            0 //-- Field id
          );

          //-- Field 1: Checkbox for selecting if the constant is a
          //-- local parameter or not
          let field1 = new CheckboxField(
            gettextCatalog.getString('Local parameter'),
            local, //-- Default value
            1 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field0);
          this.addField(field1);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;

          //-- Store the initial values
          //-- (For comparing it later with the new ones and detect if
          //--  there have been changes)
          this.nameIni = names;
          this.localIni = local;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();

          //-- Values[0]: Constant names
          //-- Parse the Constant names
          this.names = Form.parseNames(this.values[0].replace(/\s+/g, ''));

          //-- Values[1] is the checkbox that indicates if the memory
          //-- is a local parameter or not
          this.local = this.values[1];
        }

        //-----------------------------------------------------------------------
        //-- Get the Information of the port(s): name, range, size...
        //-- and store it in the portInfo property
        //--
        //-- ERRORs are check and Notifications raised in case of errors
        //------------------------------------------------------------------------
        getPortInfo(evt) {
          let portInfo;
          this.portInfos = [];

          //-- Check all the ports (The user may have include one or more)
          for (let name of this.names) {
            //-- Get the port Info: port name, size...
            portInfo = Form.parsePortName(name);

            //-- No portInfo... The was a syntax error
            if (!portInfo) {
              //-- Do not close the form
              evt.cancel = true;

              //-- Show a warning notification
              this.resultAlert = alertify.warning(
                gettextCatalog.getString('Wrong block name {{name}}', {
                  name: name,
                })
              );
              return;
            }

            //-- TODO: Check sizes

            //-- Store the current portInfo
            this.portInfos.push(portInfo);
          }

          //-- Close the form when finish
          evt.cancel = false;
        }

        //------------------------------------------------
        //-- Process the information enter by the user
        //------------------------------------------------
        process(evt) {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();

          //-- Get the ports info and check for errors
          this.getPortInfo(evt);
        }

        //-------------------------------------------------------------
        //-- Create the blocks defined in the form
        //-- Call this methods only when the form has been processed!
        //-------------------------------------------------------------
        newBlocks() {
          //-- Array for storing all the blocks created
          let blocks = [];
          let block;

          for (let i in this.portInfos) {
            //-- Create the block
            block = this.newBlock(i);

            //-- Store this block in the array
            blocks.push(block);
          }

          //-- Return an array of Blocks
          return blocks;
        }

        //-------------------------------------------------------------
        //-- Create the block defined in the form
        //-- Call this method only when the form has been processed!
        //--
        //-- INPUTS:
        //--   * n:  Number of block to create
        //--
        //-- RETURN:
        //--   * The Memory block
        //-------------------------------------------------------------
        newBlock(n) {
          //-- Create the block
          let block = new blocks.ConstantBlock(this.names[n], '', this.local);

          return block;
        }

        //-----------------------------------------------------------------------
        //-- Detect if the form was changed by the user
        //--
        //--  RETURN: A boolean value indicating the change
        //--    * true: There was a change in the block
        //--    * false: No change in the block
        //-----------------------------------------------------------------------
        changed() {
          //-- Compare these values with the initial ones
          //-- to detec if there has been a change
          //-- All the items compared are Strings
          let changed =
            this.nameIni !== this.values[0] || this.localIni !== this.local;

          //-- Return a boolean value
          return changed;
        }
      }

      class FormSelectBoard extends Form {
        constructor() {
          //-- Create a blank Form (calling the upper Class)
          super();

          //-------- Field 0: Combobox

          //-- Get all the boards
          let options = common.boards.map((board) => {
            return {
              value: board.name,
              label: board.info.label,
            };
          });

          //-- Create the ComboboxField
          let field0 = new ComboboxField(
            options,
            gettextCatalog.getString('Select your board'), //-- Top message
            '', //-- Default value
            0 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field0);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();
        }

        process() {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();
        }
      }

      class FormLogfile extends Form {
        constructor(logfile) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //----- Add the different Fields:

          //-- Field 0: Log filename
          let field0 = new TextField(
            gettextCatalog.getString('Enter the log filename'), //-- Top message
            logfile, //-- Constant block names
            0 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field0);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();
        }

        process() {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();
        }
      }

      class FormExternalPlugins extends Form {
        constructor(filename) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //----- Add the different Fields:

          //-- Field 0: Log filename
          let field0 = new TextField(
            gettextCatalog.getString('Enter the external plugins path'), //-- Top message
            filename, //-- External pluging full path
            0 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field0);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();
        }

        process() {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();
        }
      }

      class FormPythonEnv extends Form {
        constructor(pythonPath, pipPath) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //----- Add the different Fields:

          //-- Field 0: Python path
          let field0 = new TextField(
            gettextCatalog.getString('Enter the python path'), //-- Top message
            pythonPath, //-- Python path
            0 //-- Field id
          );

          //-- Field 1: Pip path
          let field1 = new TextField(
            gettextCatalog.getString('Enter the pip path'), //-- Top message
            pipPath, //-- Pip path
            1 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field0);
          this.addField(field1);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();
        }

        process() {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();
        }
      }

      class FormExternalCollections extends Form {
        constructor(collectionPath) {
          //-- Create a blank Form (calling the upper Class)
          super();

          //----- Add the different Fields:

          //-- Field 0: External collection path
          let field0 = new TextField(
            gettextCatalog.getString('Enter the external collection path'), //-- Top message
            collectionPath, //-- Python path
            0 //-- Field id
          );

          //-- Add the fields to the form
          this.addField(field0);

          //-- Control the notifications generated by
          //-- the errors when processing the form
          this.resultAlert = null;
        }

        //-------------------------------------------------------
        //-- Analize the values introduce by the user and
        //-- store them as properties
        //-------------------------------------------------------
        parseFields() {
          //-- Read the values from the form
          this.values = this.readFields();
        }

        process() {
          //-- If there was a previous notification, dismiss it
          if (this.resultAlert) {
            this.resultAlert.dismiss(false);
          }

          //-- Parse the Fields
          this.parseFields();
        }
      }

      //--------------------------------------------------------------

      //-- Public classes
      this.Form = Form;
      this.TextField = TextField;
      this.CheckboxField = CheckboxField;
      this.FormBasicInput = FormBasicInput;
      this.FormBasicOutput = FormBasicOutput;
      this.FormBasicInputLabel = FormBasicInputLabel;
      this.FormBasicOutputLabel = FormBasicOutputLabel;
      this.FormBasicPairedLabels = FormBasicPairedLabels;
      this.FormBasicCode = FormBasicCode;
      this.FormBasicMemory = FormBasicMemory;
      this.FormBasicConstant = FormBasicConstant;
      this.FormSelectBoard = FormSelectBoard;
      this.FormLogfile = FormLogfile;
      this.FormExternalPlugins = FormExternalPlugins;
      this.FormPythonEnv = FormPythonEnv;
      this.FormExternalCollections = FormExternalCollections;

      //------------------------------------------------------------------------
      //-- Private functions
      //------------------------------------------------------------------------
      function updateIOPortsTable(instance, textList, type) {
        const newNames = textList
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n !== '');

        const defaultRow = ['', 'IN', 0, false, false, true];
        const data = instance.getData();

        const nameToRowIndex = new Map();
        const usedIndexes = new Set();

        data.forEach((row, index) => {
          const name = row[0];
          if (name) {
            nameToRowIndex.set(name, index);
          }
        });

        newNames.forEach((name) => {
          if (nameToRowIndex.has(name)) {
            const i = nameToRowIndex.get(name);
            const row = instance.getData()[i];
            if (row[1] !== type) {
              instance.setValueFromCoords(1, i, type);
            }
            usedIndexes.add(i);
          } else {
            let reused = false;
            for (let i = 0; i < data.length; i++) {
              const [existingName, existingType] = data[i];
              if (
                existingType === type &&
                !newNames.includes(existingName) &&
                !usedIndexes.has(i) &&
                existingName
              ) {
                instance.setValueFromCoords(0, i, name);
                usedIndexes.add(i);
                reused = true;
                break;
              }
            }
            if (!reused) {
              instance.insertRow([name, type, 0, false, false, true]);
            }
          }
        });

        for (let i = instance.getData().length - 1; i >= 0; i--) {
          const [name, rowType] = instance.getData()[i];
          if (rowType === type && name && !newNames.includes(name)) {
            instance.deleteRow(i);
          }
        }

        const updated = instance.getData();
        for (let i = updated.length - 1; i >= 0; i--) {
          if (!updated[i][0]) {
            instance.deleteRow(i);
          }
        }

        instance.insertRow([...defaultRow]);
      }
    }
  );
