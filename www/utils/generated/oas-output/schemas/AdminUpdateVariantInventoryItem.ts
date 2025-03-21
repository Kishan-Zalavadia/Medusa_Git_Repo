/**
 * @schema AdminUpdateVariantInventoryItem
 * type: object
 * description: The properties to update of the variant's inventory item association.
 * x-schemaName: AdminUpdateVariantInventoryItem
 * required:
 *   - required_quantity
 * properties:
 *   required_quantity:
 *     type: number
 *     title: required_quantity
 *     description: The number of units a single quantity is equivalent to. For example, if a customer orders one quantity of the variant, Medusa checks the availability of the quantity multiplied by the
 *       value set for `required_quantity`. When the customer orders the quantity, Medusa reserves the ordered quantity multiplied by the value set for `required_quantity`.
 * 
*/

